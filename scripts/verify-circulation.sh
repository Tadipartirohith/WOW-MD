#!/bin/sh
# Live verification of the intake and circulation flows: how an Indian matrimony
# agency actually works — a family hands over their details at the desk, and the
# agent circulates the biodata looking for a match.
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
#     sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-circulation.sh"
#
# Needs MAIL_PROVIDER=log so invitation links come back on the response.
API=${API:-http://backend:3000/api}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@wow.example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-AdminLocalDev2026!}
PASS=0
FAIL=0
STAMP=$(head -c 8 /proc/sys/kernel/random/uuid | tr -d '-')
NUM=$(head -c 4 /proc/sys/kernel/random/uuid | tr -cd '0-9' | head -c 4)
[ -z "$NUM" ] && NUM=4242

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
    printf '  PASS  %s (HTTP %s)\n' "$name" "$actual"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %s (got %s, expected %s) %s\n' "$name" "$actual" "$expected" "$(head -c 300 /tmp/body)"
    FAIL=$((FAIL + 1))
  fi
}

assert() {
  name=$1; cond=$2
  if [ "$cond" = "1" ]; then printf '  PASS  %s\n' "$name"; PASS=$((PASS + 1));
  else printf '  FAIL  %s %s\n' "$name" "$(head -c 250 /tmp/body)"; FAIL=$((FAIL + 1)); fi
}

field() { jq -r ".$2 // empty" "$1"; }

# Phone is the duplicate key for an agency-built profile, and the check is
# global by design — the same number twice means the same person twice. So the
# numbers have to be unique per run, or a second run of this suite collides
# with the first one's data and every downstream check fails for the wrong
# reason.
PHONE_BASE=$(date +%s | tail -c 7)
phone() { echo "+919${PHONE_BASE}$1"; }

jqok()  { jq -e "$1" /tmp/body >/dev/null 2>&1 && echo 1 || echo 0; }

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

# Consent block reused across intake calls.
CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","notes":"Father visited the office with the biodata."}'
CONSENT_OK='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","allowsCirculation":true}'

reg() {
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"Test $key\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}

approve_agency() { # approve_agency <token> <name>
  c=$(req PUT /agents/agency "{\"agencyName\":\"$2\",\"city\":\"Hyderabad\"}" "$1")
  AG=$(field /tmp/body id)
  c=$(req PUT "/admin/agents/$AG/approve" "" "$ADMIN")
  check "admin approves $2" "$c" 200
}

echo
echo "== 1. Accounts =="
reg agentA agent ""
reg agentB agent ""
reg family individual family
reg bride individual bride
AGENT_A=$(field /tmp/agentA.json accessToken)
AGENT_B=$(field /tmp/agentB.json accessToken)
FAMILY=$(field /tmp/family.json accessToken)
BRIDE=$(field /tmp/bride.json accessToken)
BRIDE_ID=$(jq -r '.user.id' /tmp/bride.json)

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin sign-in" "$c" 200
ADMIN=$(field /tmp/body accessToken)
AGENT_B_ID=$(jq -r '.user.id' /tmp/agentB.json)

approve_agency "$AGENT_A" "Agency A $STAMP"
approve_agency "$AGENT_B" "Agency B $STAMP"

echo
echo "== 2. Walk-in intake: phone required, email optional =="
# The realistic case: a family gives a number and nothing else.
c=$(req POST /agents/profiles "{\"displayName\":\"Priya $STAMP\",\"contactPhone\":\"+9198765${NUM}1\",\"gender\":\"female\",\"dateOfBirth\":\"1997-04-12\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT_A")
check "profile created with NO email address" "$c" 201
cp /tmp/body /tmp/priya.json
PRIYA=$(field /tmp/priya.json id)
assert "email is null on the profile" "$(jq -e '.contactEmail == null' /tmp/priya.json >/dev/null && echo 1 || echo 0)"

c=$(req POST /agents/profiles "{\"displayName\":\"NoPhone\",\"contactEmail\":\"np-$STAMP@t.com\",$CONSENT}" "$AGENT_A")
check "mobile number is still required" "$c" 400
c=$(req POST /agents/profiles "{\"displayName\":\"NoConsent\",\"contactPhone\":\"+9198765${NUM}9\"}" "$AGENT_A")
check "a profile cannot be created without recorded consent" "$c" 400

echo
echo "== 3. Duplicate detection by phone =="
c=$(req POST /agents/profiles "{\"displayName\":\"Priya Again\",\"contactPhone\":\"+9198765${NUM}1\",$CONSENT}" "$AGENT_A")
check "the same number cannot be taken on twice" "$c" 409
assert "and the agent is told which profile it clashes with" "$(grep -qi 'already have a profile' /tmp/body && echo 1 || echo 0)"

c=$(req POST /agents/profiles "{\"displayName\":\"Priya Elsewhere\",\"contactPhone\":\"+9198765${NUM}1\",$CONSENT}" "$AGENT_B")
check "another agency is also blocked from duplicating" "$c" 409
assert "without revealing whose book it is in" "$(grep -qi 'A profile already exists' /tmp/body && echo 1 || echo 0)"

echo
echo "== 4. Consent gates circulation, separately from intake =="
c=$(req GET "/circulation/profiles/$PRIYA/consent" "" "$AGENT_A")
check "consent state is readable" "$c" 200
assert "intake consent is recorded" "$(jqok '.intake != null')"
assert "circulation is NOT implied by intake" "$(jqok '.mayCirculate == false')"

c=$(req POST /circulation/share/link "{\"profileId\":\"$PRIYA\"}" "$AGENT_A")
check "cannot circulate without circulation consent" "$c" 403
c=$(req PUT "/circulation/profiles/$PRIYA/pool" '{"visibility":"pool"}' "$AGENT_A")
check "cannot enter the pool without circulation consent" "$c" 403

c=$(req POST "/circulation/profiles/$PRIYA/consent" '{"scope":"circulation","method":"phone","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-02"}' "$AGENT_A")
check "agent records circulation consent" "$c" 201
assert "circulation is now permitted" "$(jqok '.mayCirculate == true')"
assert "and it carries an expiry, so it must be re-confirmed" "$(jqok '.circulation.expiresAt != null')"

c=$(req POST "/circulation/profiles/$PRIYA/consent" '{"scope":"circulation","method":"phone","givenByRelation":"father","givenByName":"Someone Else","givenAt":"2026-08-02"}' "$AGENT_B")
check "another agency cannot record consent on that profile" "$c" 403

echo
echo "== 5. Circulate to another agent =="
c=$(req GET /circulation/agents "" "$AGENT_A")
check "agent directory lists approved agencies" "$c" 200
assert "and never includes yourself" "$(jq -e --arg me "$(jq -r '.user.id' /tmp/agentA.json)" '[.data[] | select(.userId == $me)] | length == 0' /tmp/body >/dev/null && echo 1 || echo 0)"

c=$(req POST /circulation/share/agent "{\"profileId\":\"$PRIYA\",\"agentUserId\":\"$AGENT_B_ID\",\"message\":\"Looking for a groom in Hyderabad.\"}" "$AGENT_A")
check "agent A shares the profile with agent B" "$c" 201

c=$(req GET /circulation/shared-with-me "" "$AGENT_B")
check "agent B sees it in shared-with-me" "$c" 200
assert "the biodata carries the detail needed to assess it" "$(jqok '.[0].profile.displayName != null and (.[0].profile | has("photos"))')"
assert "and the covering note came through" "$(jqok '.[0].message != null')"

c=$(req PUT "/agents/profiles/$PRIYA" '{"city":"Chennai"}' "$AGENT_B")
check "a share grants read only, never edit" "$c" 403
c=$(req GET "/matches/suggestions?profileId=$PRIYA" "" "$AGENT_B")
check "a share never lets you act as the profile" "$c" 403

echo
echo "== 6. Circulate directly to a platform user =="
c=$(req POST /circulation/share/user "{\"profileId\":\"$PRIYA\",\"userId\":\"$BRIDE_ID\"}" "$AGENT_A")
check "agent shares straight to a user who has an account" "$c" 201
c=$(req GET /circulation/shared-with-me "" "$BRIDE")
check "that user sees it" "$c" 200
assert "exactly one profile shared with them" "$(jqok 'length == 1')"

echo
echo "== 7. Shareable biodata link, for a family with no account =="
c=$(req POST /circulation/share/link "{\"profileId\":\"$PRIYA\",\"expiresInDays\":7}" "$AGENT_A")
check "agent creates a biodata link" "$c" 201
LINK=$(field /tmp/body url)
TOKEN=$(printf '%s' "$LINK" | sed 's|.*/biodata/||')
SHARE_ID=$(jq -r '.share.id' /tmp/body)

c=$(req GET "/circulation/biodata/$TOKEN")
check "the link opens with no account at all" "$c" 200
assert "and shows the full biodata" "$(jqok '.displayName != null and .dateOfBirth != null')"

c=$(req GET "/circulation/biodata/$(printf '%s' "$TOKEN" | tr 'a-z' 'A-Z')xx")
check "a tampered link is refused" "$c" 404

c=$(req DELETE "/circulation/shares/$SHARE_ID" "" "$AGENT_A")
check "the agent can withdraw the link" "$c" 200
c=$(req GET "/circulation/biodata/$TOKEN")
check "and it stops working immediately" "$c" 404

echo
echo "== 8. The vetted-agent pool =="
c=$(req PUT "/circulation/profiles/$PRIYA/pool" '{"visibility":"pool"}' "$AGENT_A")
check "agent A pools the profile" "$c" 200
c=$(req GET /circulation/pool "" "$AGENT_B")
check "agent B can search the pool" "$c" 200
assert "and finds it" "$(jq -e --arg id "$PRIYA" '[.data[] | select(.id == $id)] | length == 1' /tmp/body >/dev/null && echo 1 || echo 0)"

c=$(req GET /circulation/pool "" "$AGENT_A")
assert "an agent never sees their own listings in the pool" "$(jq -e --arg id "$PRIYA" '[.data[] | select(.id == $id)] | length == 0' /tmp/body >/dev/null && echo 1 || echo 0)"

c=$(req GET /circulation/pool "" "$BRIDE")
check "a normal user cannot browse the pool" "$c" 403
c=$(req GET /circulation/pool "" "$FAMILY")
check "nor can a family steward" "$c" 403

echo
echo "== 9. Withdrawing consent pulls everything back =="
c=$(req GET "/circulation/profiles/$PRIYA/consent/history" "" "$AGENT_A")
check "consent history is auditable" "$c" 200
CIRC_ID=$(jq -r '[.[] | select(.scope=="circulation")][0].id' /tmp/body)

c=$(req DELETE "/circulation/consent/$CIRC_ID" '{"reason":"Family asked us to stop."}' "$AGENT_A")
check "agent withdraws circulation consent" "$c" 200
assert "circulation is blocked again" "$(jqok '.mayCirculate == false')"
assert "and it reads as needing re-confirmation" "$(jqok '.needsReconfirmation == true')"

c=$(req GET /circulation/pool "" "$AGENT_B")
assert "the profile drops out of the pool at once" "$(jq -e --arg id "$PRIYA" '[.data[] | select(.id == $id)] | length == 0' /tmp/body >/dev/null && echo 1 || echo 0)"
c=$(req POST /circulation/share/link "{\"profileId\":\"$PRIYA\"}" "$AGENT_A")
check "and no new links can be issued" "$c" 403

c=$(req DELETE "/circulation/profiles/$PRIYA/shares" "" "$AGENT_A")
check "agent withdraws every outstanding share" "$c" 200
c=$(req GET /circulation/shared-with-me "" "$AGENT_B")
assert "agent B no longer holds it" "$(jqok 'length == 0')"

echo
echo "== 10. Cross-agent proposal thread =="
# Re-consent so the pairing can be set up.
req POST "/circulation/profiles/$PRIYA/consent" '{"scope":"circulation","method":"phone","givenByRelation":"father","givenByName":"Ramesh","givenAt":"2026-08-03"}' "$AGENT_A" >/dev/null

c=$(req POST /agents/profiles "{\"displayName\":\"Arjun $STAMP\",\"contactPhone\":\"+9198765${NUM}2\",\"gender\":\"male\",\"dateOfBirth\":\"1995-02-02\",\"city\":\"Hyderabad\",$CONSENT_OK}" "$AGENT_B")
check "agent B builds the other side" "$c" 201
ARJUN=$(field /tmp/body id)

c=$(req POST /matches/interest "{\"toProfileId\":\"$ARJUN\",\"profileId\":\"$PRIYA\"}" "$AGENT_A")
check "agent A proposes the pairing" "$c" 201
INTEREST=$(field /tmp/body id)

c=$(req GET "/circulation/proposals/$INTEREST" "" "$AGENT_A")
check "agent A can open the thread" "$c" 200
assert "both sides are shown, with who handles each" "$(jqok '.sides | length == 2 and (map(select(.isMine)) | length == 1)')"
c=$(req GET "/circulation/proposals/$INTEREST" "" "$AGENT_B")
check "agent B can open it too" "$c" 200
c=$(req GET "/circulation/proposals/$INTEREST" "" "$BRIDE")
check "an unrelated user cannot" "$c" 403

c=$(req POST "/circulation/proposals/$INTEREST/notes" '{"body":"Horoscopes match. Can the families meet on Sunday?"}' "$AGENT_A")
check "agent A posts a note" "$c" 201
c=$(req POST "/circulation/proposals/$INTEREST/notes" '{"body":"Checking with them, will confirm tomorrow."}' "$AGENT_B")
check "agent B replies" "$c" 201
c=$(req POST "/circulation/proposals/$INTEREST/notes" '{"body":"butting in"}' "$BRIDE")
check "an unrelated user cannot post" "$c" 403

c=$(req GET "/circulation/proposals/$INTEREST" "" "$AGENT_A")
assert "the thread reads back in order" "$(jqok '.notes | length == 2 and (.[0].mine == true) and (.[1].mine == false)')"

echo
echo "== 11. Family stewards circulate, but do not browse the network =="
c=$(req POST /agents/profiles "{\"displayName\":\"Cousin $STAMP\",\"contactPhone\":\"+9198765${NUM}3\",\"gender\":\"female\",$CONSENT_OK}" "$FAMILY")
check "a family account builds a relative profile" "$c" 201
COUSIN=$(field /tmp/body id)
c=$(req POST /circulation/share/link "{\"profileId\":\"$COUSIN\"}" "$FAMILY")
check "and can send out a biodata link" "$c" 201
c=$(req POST /circulation/share/agent "{\"profileId\":\"$COUSIN\",\"agentUserId\":\"$AGENT_B_ID\"}" "$FAMILY")
check "and hand it to an agent" "$c" 201
c=$(req GET /circulation/pool "" "$FAMILY")
check "but cannot trawl other agencies' books" "$c" 403

echo
echo "== 12. Audit trail covers consent and circulation =="
c=$(req GET "/admin/audit?action=consent.circulation_recorded" "" "$ADMIN")
check "consent records are audited" "$c" 200
assert "at least one circulation consent event" "$(jqok '.data | length > 0')"
c=$(req GET "/admin/audit?action=profile.shared" "" "$ADMIN")
assert "every share is audited" "$(jqok '.data | length > 0')"
c=$(req GET "/admin/audit?action=consent.revoked" "" "$ADMIN")
assert "withdrawal is audited" "$(jqok '.data | length > 0')"

echo
echo "============================="
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
echo "============================="
[ "$FAIL" = "0" ]
