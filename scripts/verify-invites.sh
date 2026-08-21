#!/bin/sh
# Live verification of the invitation / shadow-profile flows and the hardening
# added in Phase 4. Run from inside the compose network, same as
# verify-rbac.sh:
#
#   docker run --rm --network docker_default \
#     -v "$PWD/scripts:/scripts" -v "$PWD/docker:/docker" alpine:3.20 \
#     sh -c "apk add --no-cache curl jq >/dev/null && sh /scripts/verify-invites.sh"
#
# Needs MAIL_PROVIDER=log on the backend: in that mode the invite response
# carries the link, since nothing is actually delivered.
API=${API:-http://backend:3000/api}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@wow.example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-AdminLocalDev2026!}
PASS=0
FAIL=0
STAMP=$(head -c 8 /proc/sys/kernel/random/uuid | tr -d '-')

req() {
  m=$1; p=$2; b=$3; t=$4
  set -- -s -o /tmp/body -w '%{http_code}' -X "$m" "$API$p"
  [ -n "$b" ] && set -- "$@" -H 'Content-Type: application/json' -d "$b"
  [ -n "$t" ] && set -- "$@" -H "Authorization: Bearer $t"
  curl "$@"
}

check() {
  name=$1; actual=$2; expected=$3
  if [ "$actual" = "$expected" ]; then
    printf '  PASS  %s (HTTP %s)\n' "$name" "$actual"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %s (got %s, expected %s) %s\n' "$name" "$actual" "$expected" "$(head -c 300 /tmp/body)"
    FAIL=$((FAIL + 1))
  fi
}

assert() {
  name=$1; cond=$2
  if [ "$cond" = "1" ]; then
    printf '  PASS  %s\n' "$name"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %s %s\n' "$name" "$(head -c 200 /tmp/body)"; FAIL=$((FAIL + 1))
  fi
}

field() { jq -r ".$2 // empty" "$1"; }

# Phone is the duplicate key for an agency-built profile, and the check is
# global by design — the same number twice means the same person twice. So the
# numbers have to be unique per run, or a second run of this suite collides
# with the first one's data and every downstream check fails for the wrong
# reason.
PHONE_BASE=$(date +%s | tail -c 7)
phone() { echo "+919${PHONE_BASE}$1"; }


# Intake now records how the family gave permission, so every profile the agent
# builds carries a consent block. Defined once and appended to each body below.
CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","allowsCirculation":true}'


# Rate-limit counters live in Redis and deliberately survive restarts, so a
# repeated run inside the same window would trip limits that have nothing to do
# with what is being tested. Clear only the throttle keys (never the caches).
if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
else
  echo "-- redis-cli unavailable: rate limits may trip on a repeated run --"
fi

# Registration now insists on a real person's name (letters and spaces only)
# and, for a business account, a 10-digit mobile. The counter keeps each
# registration on its own number.
# A distinct 10-digit mobile per registration. The number has to start 6-9 and
# be unique enough that two runs do not collide on the profile duplicate check.
REG_PHONE_BASE=$(date +%s | tail -c 7)
# Suffixes start at 900 so a registration number can never collide with the
# profile numbers `phone()` hands out in the same run.
regphone() { printf '9%s%03d' "$REG_PHONE_BASE" "$((900 + $1))"; }
REG_N=0
reg() { # reg key accountType role -> writes /tmp/$key.json
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  REG_N=$((REG_N + 1))
  name="Test $(echo "$key" | tr -d '0-9')"
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"$name\",\"phone\":\"$(regphone $REG_N)\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}

echo
echo "== 1. Personas =="
reg solo individual bride
reg groom individual groom
reg agent agent ""
reg agent2 agent ""
reg family individual family

SOLO=$(field /tmp/solo.json accessToken)
GROOM=$(field /tmp/groom.json accessToken)
AGENT=$(field /tmp/agent.json accessToken)
AGENT2=$(field /tmp/agent2.json accessToken)
FAMILY=$(field /tmp/family.json accessToken)

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin sign-in" "$c" 200
ADMIN=$(field /tmp/body accessToken)

echo
echo "== 2. A solo user can always sign in and act =="
c=$(req POST /auth/login "{\"email\":\"solo-$STAMP@t.com\",\"password\":\"Password123\"}")
check "solo user signs in with their own password" "$c" 200
grep -q '"managedByAgentId":null' /tmp/body && assert "solo user is tied to no agency" 1 || assert "solo user is tied to no agency" 0
SOLO=$(field /tmp/body accessToken)

# Matchmaking is gated on a complete profile now, so an account that has only
# just registered is refused until it fills one in. Checked here rather than
# assumed, because it is the gate every new individual user meets first.
c=$(req GET /matches/suggestions "" "$SOLO")
check "an incomplete profile cannot browse matches" "$c" 403

# The engine needs more than city and age to clear MATCH_MIN_SCORE: with
# defaults, same-city plus a 2-year age gap does not reach it. Matching
# religion, education and lifestyle takes the pair well over the threshold.
PREFS='{"religion":"hindu","education":"masters","lifestyle":["vegetarian","non-smoker"]}'
req PUT /users/me/profile "{\"displayName\":\"Solo $STAMP\",\"gender\":\"female\",\"dateOfBirth\":\"1996-06-15\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS,\"photos\":[\"https://cdn.example.com/s1.jpg\",\"https://cdn.example.com/s2.jpg\"]}" "$SOLO" >/dev/null

c=$(req GET /matches/suggestions "" "$SOLO")
check "solo user browses matches unaided once the profile is complete" "$c" 200

echo
echo "== 3. An unvetted agent cannot build profiles =="
c=$(req POST /agents/profiles "{\"displayName\":\"Blocked\",\"contactEmail\":\"blocked-$STAMP@t.com\",\"contactPhone\":\"$(phone 001)\",$CONSENT}" "$AGENT")
check "unapproved agency cannot create a profile" "$c" 403
c=$(req GET /agents/agency/status "" "$AGENT")
check "agency status is readable" "$c" 200
grep -q '"registered":false' /tmp/body && assert "status reports nothing registered yet" 1 || assert "status reports nothing registered yet" 0

c=$(req PUT /agents/agency "{\"agencyName\":\"Agency $STAMP\",\"city\":\"Hyderabad\",\"contactPhone\":\"$(phone 002)\"}" "$AGENT")
check "agent registers their agency" "$c" 200
AGENCY=$(field /tmp/body id)

c=$(req POST /agents/profiles "{\"displayName\":\"Still Blocked\",\"contactEmail\":\"blocked2-$STAMP@t.com\",\"contactPhone\":\"$(phone 003)\",$CONSENT}" "$AGENT")
check "registered but unapproved agency still cannot create" "$c" 403

c=$(req GET /admin/agents/pending "" "$SOLO")
check "a normal user cannot see pending agencies" "$c" 403
c=$(req GET /admin/agents/pending "" "$ADMIN")
check "admin lists pending agencies" "$c" 200
c=$(req PUT "/admin/agents/$AGENCY/approve" "" "$ADMIN")
check "admin approves the agency" "$c" 200

echo
echo "== 4. Agent builds a profile for someone with NO account =="
c=$(req POST /agents/profiles "{\"displayName\":\"Priya $STAMP\",\"contactEmail\":\"priya-$STAMP@t.com\",\"contactPhone\":\"$(phone 004)\",\"gender\":\"female\",\"dateOfBirth\":\"1997-04-12\",\"city\":\"Hyderabad\",\"bio\":\"Loves classical music.\",\"photos\":[\"https://cdn.example.com/a.jpg\",\"https://cdn.example.com/b.jpg\"],$CONSENT}" "$AGENT")
check "agent creates a profile with photos and details" "$c" 201
cp /tmp/body /tmp/managed.json
MANAGED=$(field /tmp/managed.json id)
grep -q '"userId":null' /tmp/managed.json && assert "the profile has no account behind it" 1 || assert "the profile has no account behind it" 0
grep -q '"claimStatus":"unclaimed"' /tmp/managed.json && assert "profile is unclaimed" 1 || assert "profile is unclaimed" 0

c=$(req POST "/agents/profiles/$MANAGED/photos" '{"url":"https://cdn.example.com/c.jpg"}' "$AGENT")
check "agent adds another photo" "$c" 201
c=$(req POST "/agents/profiles/$MANAGED/photos" '{"url":"not-a-url"}' "$AGENT")
check "a non-url photo is rejected" "$c" 400

# Email became optional when intake moved to phone-first: a walk-in family
# hands over a number far more often than an address.
c=$(req POST /agents/profiles "{\"displayName\":\"NoEmail $STAMP\",\"contactPhone\":\"$(phone 005)\",$CONSENT}" "$AGENT")
check "a profile can be built with no email at all" "$c" 201
c=$(req POST /agents/profiles "{\"displayName\":\"NoPhone\",\"contactEmail\":\"nophone-$STAMP@t.com\",$CONSENT}" "$AGENT")
check "but the mobile number is still required" "$c" 400
c=$(req POST /agents/profiles "{\"displayName\":\"BadPhone\",\"contactEmail\":\"badphone-$STAMP@t.com\",\"contactPhone\":\"12\",$CONSENT}" "$AGENT")
check "a malformed mobile is rejected" "$c" 400

c=$(req GET "/agents/profiles/$MANAGED" "" "$AGENT2")
check "another agent cannot read that profile" "$c" 403
c=$(req PUT "/agents/profiles/$MANAGED" '{"city":"Chennai"}' "$AGENT2")
check "another agent cannot edit that profile" "$c" 403

echo
echo "== 5. The unclaimed profile is matchable straight away =="
c=$(req GET "/matches/suggestions?profileId=$MANAGED" "" "$AGENT")
check "agent browses as the unclaimed profile" "$c" 200
c=$(req GET "/matches/suggestions?profileId=$MANAGED" "" "$AGENT2")
check "another agent cannot browse as it" "$c" 403

GROOM_PROFILE=$(req GET /agents/profiles/actable "" "$GROOM" >/dev/null 2>&1; echo "")
c=$(req GET /users/me "" "$GROOM")
GP=$(field /tmp/body id)
c=$(req POST /matches/interest "{\"toProfileId\":\"$GP\",\"profileId\":\"$MANAGED\"}" "$AGENT")
check "agent sends an interest FROM the unclaimed profile" "$c" 201
INTEREST=$(field /tmp/body id)
grep -q "\"fromProfileId\":\"$MANAGED\"" /tmp/body && assert "interest is keyed on the profile, not an account" 1 || assert "interest is keyed on the profile, not an account" 0

c=$(req POST /matches/interest "{\"toProfileId\":\"$GP\",\"profileId\":\"$MANAGED\"}" "$AGENT2")
check "another agent cannot send from that profile" "$c" 403
c=$(req PUT "/matches/$INTEREST/accept" "" "$GROOM")
check "the recipient accepts the interest" "$c" 200

echo
echo "== 6. Profile privacy in suggestions =="
# SOLO's profile was completed at sign-in; the groom's is filled in here so the
# pair actually score against each other.
req PUT /users/me/profile "{\"displayName\":\"Groom $STAMP\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS,\"photos\":[\"https://cdn.example.com/g1.jpg\",\"https://cdn.example.com/g2.jpg\"]}" "$GROOM" >/dev/null
# GROOM has not fetched suggestions yet, so this is not served from the cache
# that SOLO warmed up before the profiles had any detail on them.
c=$(req GET /matches/suggestions "" "$GROOM")
if jq -e '.data | length > 0' /tmp/body >/dev/null 2>&1; then
  jq -e '.data[0].profile | has("dateOfBirth") | not' /tmp/body >/dev/null \
    && assert "exact date of birth is never returned" 1 || assert "exact date of birth is never returned" 0
  jq -e '.data[0].profile | has("ageRange")' /tmp/body >/dev/null \
    && assert "an age band is returned instead" 1 || assert "an age band is returned instead" 0
else
  echo "  FAIL  expected at least one suggestion to inspect"
  FAIL=$((FAIL + 1))
fi

echo
echo "== 7. Invitation: the subject claims the profile =="
c=$(req POST "/agents/profiles/$MANAGED/invite" "" "$AGENT2")
check "another agent cannot invite on that profile" "$c" 403
c=$(req POST "/agents/profiles/$MANAGED/invite" "" "$AGENT")
check "agent emails the invitation" "$c" 201

# With MAIL_PROVIDER=log there is no real inbox, so the API hands the link back
# on the response (dev only, see InvitationsService.invite).
TOKEN=$(field /tmp/body devToken)
if [ -z "$TOKEN" ]; then
  echo "  NOTE  no devToken on the response (MAIL_PROVIDER is not 'log'); skipping claim checks"
else
  c=$(req GET "/auth/invitations/$TOKEN")
  check "invitation preview is public" "$c" 200
  jq -e 'has("email") and has("invitedBy") and (has("photos") | not)' /tmp/body >/dev/null \
    && assert "preview shows who invited whom, not the whole profile" 1 \
    || assert "preview shows who invited whom, not the whole profile" 0

  c=$(req POST /auth/invitations/accept "{\"token\":\"$TOKEN\",\"password\":\"weak\"}")
  check "a weak password is refused when claiming" "$c" 400

  c=$(req POST /auth/invitations/accept "{\"token\":\"$TOKEN\",\"password\":\"ClaimedPass1\"}")
  check "the subject claims the profile and is signed in" "$c" 201
  cp /tmp/body /tmp/claimed.json
  CLAIMED=$(field /tmp/claimed.json accessToken)
  jq -e '.user.isVerified == true' /tmp/claimed.json >/dev/null \
    && assert "email counts as verified (they followed the link)" 1 \
    || assert "email counts as verified (they followed the link)" 0

  c=$(req POST /auth/invitations/accept "{\"token\":\"$TOKEN\",\"password\":\"ClaimedPass1\"}")
  check "the invitation cannot be used twice" "$c" 404

  c=$(req POST /auth/login "{\"email\":\"priya-$STAMP@t.com\",\"password\":\"ClaimedPass1\"}")
  check "the claimed user signs in with their OWN password" "$c" 200

  c=$(req PUT "/agents/profiles/$MANAGED" '{"city":"Chennai"}' "$AGENT")
  check "the agent can no longer edit the claimed profile" "$c" 403

  c=$(req GET /agents/clients "" "$AGENT")
  check "the claimed user appears on the agent book" "$c" 200
  grep -q "priya-$STAMP@t.com" /tmp/body \
    && assert "book of business retained after claiming" 1 \
    || assert "book of business retained after claiming" 0
fi

echo
echo "== 8. Family members steward relatives, but run no agency =="
c=$(req POST /agents/profiles "{\"displayName\":\"Relative $STAMP\",\"contactEmail\":\"rel-$STAMP@t.com\",\"contactPhone\":\"$(phone 006)\",\"gender\":\"male\",$CONSENT}" "$FAMILY")
check "a family account can build a relative profile" "$c" 201
c=$(req PUT /agents/agency '{"agencyName":"Not An Agency"}' "$FAMILY")
check "a family account cannot register an agency" "$c" 403
c=$(req GET /agents/clients "" "$FAMILY")
check "a family account has no client book" "$c" 403
c=$(req POST /agents/profiles "{\"displayName\":\"X\",\"contactEmail\":\"x-$STAMP@t.com\",\"contactPhone\":\"$(phone 007)\",$CONSENT}" "$SOLO")
check "a plain bride account cannot steward profiles" "$c" 403

echo
echo "== 9. Password reset and email verification =="
c=$(req POST /auth/password/forgot "{\"email\":\"nobody-$STAMP@t.com\"}")
check "forgot-password never reveals an unknown address" "$c" 200
c=$(req POST /auth/password/forgot "{\"email\":\"solo-$STAMP@t.com\"}")
check "forgot-password accepted for a real address" "$c" 200
c=$(req POST /auth/password/reset '{"token":"invalidinvalidinvalidinvalid","password":"Password123"}')
check "an invalid reset token is refused" "$c" 400
c=$(req POST /auth/verify-email '{"token":"invalidinvalidinvalidinvalid"}')
check "an invalid verification token is refused" "$c" 400

echo
echo "== 10. Sessions: multi-device and revocation =="
c=$(req POST /auth/login "{\"email\":\"solo-$STAMP@t.com\",\"password\":\"Password123\"}")
check "second device signs in" "$c" 200
SOLO_B=$(field /tmp/body accessToken)
c=$(req GET /auth/me/permissions "" "$SOLO")
check "the first device is still valid (multi-device works)" "$c" 200
c=$(req GET /auth/sessions "" "$SOLO_B")
check "sessions are listable" "$c" 200
jq -e 'length >= 2' /tmp/body >/dev/null && assert "two live sessions are recorded" 1 || assert "two live sessions are recorded" 0
SESSION=$(jq -r '.[0].id' /tmp/body)
c=$(req DELETE "/auth/sessions/$SESSION" "" "$GROOM")
check "one user cannot revoke another user session" "$c" 401

echo
echo "== 11. Brute-force lockout =="
LOCK_EMAIL="lock-$STAMP@t.com"
c=$(req POST /auth/register "{\"email\":\"$LOCK_EMAIL\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"bride\",\"displayName\":\"Lock Me\"}")
check "target account created" "$c" 201

# The login route is also IP rate-limited (10/min by design), and the checks
# above have already spent part of that window. Wait it out so this measures
# the per-ACCOUNT lockout rather than the per-IP throttle.
echo "-- waiting 65s for the login rate-limit window to reset --"
sleep 65

i=0
while [ $i -lt 8 ]; do
  req POST /auth/login "{\"email\":\"$LOCK_EMAIL\",\"password\":\"WrongPass9\"}" >/dev/null
  i=$((i + 1))
done
c=$(req POST /auth/login "{\"email\":\"$LOCK_EMAIL\",\"password\":\"Password123\"}")
check "the account locks after repeated failures, even with the right password" "$c" 403

echo
echo "== 12. Payment webhooks =="
c=$(req POST /payments/webhook '{"id":"evt_1","event":"payment.captured","providerRef":"mock_x","status":"captured"}')
check "an unsigned webhook is refused" "$c" 400
SIG=$(printf '%s' '{"id":"evt_1","event":"payment.captured","providerRef":"mock_x","status":"captured"}' | openssl dgst -sha256 -hmac mock_webhook_secret -hex 2>/dev/null | sed 's/.*= *//')
if [ -n "$SIG" ]; then
  c=$(curl -s -o /tmp/body -w '%{http_code}' -X POST "$API/payments/webhook" \
        -H 'Content-Type: application/json' -H "x-wow-signature: $SIG" \
        -d '{"id":"evt_1","event":"payment.captured","providerRef":"mock_x","status":"captured"}')
  check "a correctly signed webhook is accepted" "$c" 200
  c=$(curl -s -o /tmp/body -w '%{http_code}' -X POST "$API/payments/webhook" \
        -H 'Content-Type: application/json' -H "x-wow-signature: $SIG" \
        -d '{"id":"evt_1","event":"payment.captured","providerRef":"mock_x","status":"captured"}')
  check "a replayed webhook is accepted but ignored" "$c" 200
  jq -e '.duplicate == true' /tmp/body >/dev/null \
    && assert "the replay is reported as a duplicate" 1 || assert "the replay is reported as a duplicate" 0
  c=$(curl -s -o /tmp/body -w '%{http_code}' -X POST "$API/payments/webhook" \
        -H 'Content-Type: application/json' -H "x-wow-signature: ${SIG}00" \
        -d '{"id":"evt_2","event":"payment.captured","providerRef":"mock_x","status":"captured"}')
  check "a tampered signature is refused" "$c" 400
else
  echo "  NOTE  openssl unavailable; skipping signed-webhook checks"
fi

echo
echo "== 13. Audit trail =="
c=$(req GET /admin/audit "" "$SOLO")
check "a normal user cannot read the audit trail" "$c" 403
c=$(req GET /admin/audit "" "$ADMIN")
check "admin reads the audit trail" "$c" 200
jq -e '.data | length > 0' /tmp/body >/dev/null && assert "events have been recorded" 1 || assert "events have been recorded" 0
c=$(req GET "/admin/audit?action=agent.approved" "" "$ADMIN")
jq -e '.data | length > 0' /tmp/body >/dev/null \
  && assert "the agency approval was audited" 1 || assert "the agency approval was audited" 0

echo
echo "== 14. Two-factor =="
c=$(req POST /auth/mfa/setup "" "$SOLO")
check "two-factor setup returns a secret" "$c" 201
jq -e 'has("otpauthUrl") and has("secret")' /tmp/body >/dev/null \
  && assert "an otpauth URI is provided" 1 || assert "an otpauth URI is provided" 0
c=$(req POST /auth/mfa/confirm '{"code":"000000"}' "$SOLO")
check "a wrong confirmation code is refused" "$c" 400

echo
echo "== 15. Pagination bounds come from config =="
c=$(req GET "/vendors/search?limit=101" "")
check "limit above the configured maximum is refused" "$c" 400
c=$(req GET "/vendors/search?limit=100" "")
check "limit at the configured maximum is accepted" "$c" 200

echo
echo "============================="
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
echo "============================="
[ "$FAIL" = "0" ]
