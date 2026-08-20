#!/bin/sh
# Live RBAC and schema-validation verification against a running stack.
#
# Runs from inside the compose network so it does not depend on host port
# forwarding. It needs curl and jq, and an admin seeded with the credentials in
# docker/.env.
#
#   docker compose -f docker/docker-compose.yml up -d --build
#   docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 #     sh -c "apk add --no-cache curl jq >/dev/null && sh /scripts/verify-rbac.sh"
#
# Exits non-zero if any check fails, so it can gate a deploy.
API=${API:-http://backend:3000/api}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@wow.example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-AdminLocalDev2026!}
PASS=0
FAIL=0
STAMP=$(head -c 8 /proc/sys/kernel/random/uuid | tr -d '-')

# code=$(req METHOD PATH JSON TOKEN); response body lands in /tmp/body.
# Refresh tokens now travel in an httpOnly cookie, so keep a jar: that is what a
# browser does, and it is the path the app actually uses.
JAR=/tmp/cookies.txt
: > "$JAR"
req() {
  m=$1; p=$2; b=$3; t=$4
  set -- -s -o /tmp/body -w '%{http_code}' -X "$m" "$API$p" -b "$JAR" -c "$JAR"
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

# Precise extraction; jq is present in the runner image.
field() { jq -r ".$2 // empty" "$1"; }

# Intake now records how the family gave permission, so every profile the agent
# builds carries a consent block. Defined once and appended to each body below.
CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","allowsCirculation":true}'

# Phone is the duplicate key for an agency-built profile, and the check is
# global by design — the same number twice means the same person twice. So the
# numbers have to be unique per run, or the second run of this suite collides
# with the first one's data and every downstream check fails for the wrong
# reason.
PHONE_BASE=$(date +%s | tail -c 7)
phone() { echo "+919${PHONE_BASE}$1"; }


# Rate-limit counters live in Redis and deliberately survive restarts, so a
# repeated run inside the same window would trip limits unrelated to what is
# being tested. Clear only the throttle keys (never the caches).
if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi
ufield() { jq -r ".user.$2 // empty" "$1"; }

echo
echo "== 1. One account per persona =="
reg() { # reg key accountType role -> writes /tmp/$key.json
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"Test $key\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}
reg bride individual bride
reg groom individual groom
reg agent agent ""
reg agent2 agent ""
reg vendor vendor ""
reg planner planner ""

tok() { field "/tmp/$1.json" accessToken; }
uid() { ufield "/tmp/$1.json" id; }

BRIDE=$(tok bride);   GROOM=$(tok groom)
AGENT=$(tok agent);   AGENT2=$(tok agent2)
VENDOR=$(tok vendor); PLANNER=$(tok planner)
BRIDE_ID=$(uid bride); GROOM_ID=$(uid groom); AGENT_ID=$(uid agent)

grep -q '"role":"vendor"' /tmp/vendor.json && { echo "  PASS  vendor accountType mapped to vendor role"; PASS=$((PASS+1)); } || { echo "  FAIL  vendor role mapping"; FAIL=$((FAIL+1)); }
grep -q '"role":"planner"' /tmp/planner.json && { echo "  PASS  planner accountType mapped to planner role"; PASS=$((PASS+1)); } || { echo "  FAIL  planner role mapping"; FAIL=$((FAIL+1)); }
grep -q '"role":"agent"' /tmp/agent.json && { echo "  PASS  agent accountType mapped to agent role"; PASS=$((PASS+1)); } || { echo "  FAIL  agent role mapping"; FAIL=$((FAIL+1)); }
grep -q '"managedByAgentId":null' /tmp/bride.json && { echo "  PASS  self-registered user has no managing agent"; PASS=$((PASS+1)); } || { echo "  FAIL  self-registered user attached to an agent"; FAIL=$((FAIL+1)); }

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin sign-in" "$c" 200
cp /tmp/body /tmp/admin.json
ADMIN=$(tok admin)


echo
echo "-- pausing 65s: /auth/register is deliberately capped at 10/min --"
sleep 65
echo
echo "== 2. Privilege escalation at registration =="
c=$(req POST /auth/register "{\"email\":\"esc1-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"admin\"}")
check "individual + role=admin rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"esc2-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"admin\"}")
check "accountType=admin rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"esc3-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"vendor\"}")
check "individual + role=vendor rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"esc4-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"agent\"}")
check "individual + role=agent rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"weak-$STAMP@t.com\",\"password\":\"alllowercase\",\"accountType\":\"individual\",\"role\":\"bride\"}")
check "weak password rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"ex-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"bride\",\"isVerified\":true}")
check "unknown field isVerified rejected" "$c" 400
c=$(req POST /auth/register "{\"email\":\"notanemail\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"bride\"}")
check "malformed email rejected" "$c" 400

echo
echo "== 3. Only users and agents may book; providers may not =="
FAKE=00000000-0000-4000-8000-000000000000
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$FAKE\",\"amount\":1000}" "$VENDOR")
check "vendor cannot create a booking" "$c" 403
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$FAKE\",\"amount\":1000}" "$PLANNER")
check "planner cannot create a booking" "$c" 403
c=$(req GET /matches/suggestions "" "$VENDOR")
check "vendor cannot browse matches" "$c" 403
c=$(req GET /matches/suggestions "" "$PLANNER")
check "planner cannot browse matches" "$c" 403
c=$(req POST /matches/interest "{\"toUserId\":\"$GROOM_ID\"}" "$VENDOR")
check "vendor cannot send interest" "$c" 403
c=$(req POST /vendors "{\"name\":\"Sneaky\",\"category\":\"venue\"}" "$BRIDE")
check "bride cannot create a vendor listing" "$c" 403
c=$(req PUT /wedding-planners/me "{\"agencyName\":\"Sneaky\"}" "$VENDOR")
check "vendor cannot create a planner listing" "$c" 403
c=$(req POST /vendors "{\"name\":\"Sneaky\",\"category\":\"venue\"}" "$PLANNER")
check "planner cannot create a vendor listing" "$c" 403
c=$(req GET /agents/clients "" "$BRIDE")
check "bride cannot list agent clients" "$c" 403
c=$(req POST /agents/profiles "{\"displayName\":\"X\",\"contactEmail\":\"x-$STAMP@t.com\",\"contactPhone\":\"$(phone 002)\",$CONSENT}" "$VENDOR")
check "vendor cannot build a profile for anyone" "$c" 403

echo
echo "== 4. Admin surface closed to every other persona =="
for pair in "bride:$BRIDE" "agent:$AGENT" "vendor:$VENDOR" "planner:$PLANNER"; do
  n=${pair%%:*}; t=${pair#*:}
  c=$(req GET /admin/analytics "" "$t");        check "$n cannot read analytics" "$c" 403
  c=$(req GET /admin/users "" "$t");            check "$n cannot list all users" "$c" 403
  c=$(req GET /admin/vendors/pending "" "$t");  check "$n cannot see pending vendors" "$c" 403
done
c=$(req GET /admin/analytics "" "$ADMIN"); check "admin can read analytics" "$c" 200

echo
echo "== 5. Agent stewardship: vetting, profiles, invitations, scoping =="
# An agent must be vetted before they can act for anybody.
c=$(req PUT /agents/agency "{\"agencyName\":\"Agency $STAMP\",\"city\":\"Hyderabad\"}" "$AGENT")
check "agent registers their agency" "$c" 200
AGENCY=$(field /tmp/body id)
c=$(req POST /agents/profiles "{\"displayName\":\"Too Early\",\"contactEmail\":\"early-$STAMP@t.com\",\"contactPhone\":\"$(phone 003)\",$CONSENT}" "$AGENT")
check "an unapproved agency cannot build profiles" "$c" 403
c=$(req PUT "/admin/agents/$AGENCY/approve" "" "$ADMIN")
check "admin approves the agency" "$c" 200

c=$(req PUT /agents/agency "{\"agencyName\":\"Agency2 $STAMP\"}" "$AGENT2")
AGENCY2=$(field /tmp/body id)
c=$(req PUT "/admin/agents/$AGENCY2/approve" "" "$ADMIN")
check "admin approves the second agency" "$c" 200

# A profile for somebody with no account at all.
c=$(req POST /agents/profiles "{\"displayName\":\"Client $STAMP\",\"contactEmail\":\"client-$STAMP@t.com\",\"contactPhone\":\"$(phone 004)\",\"gender\":\"female\",\"dateOfBirth\":\"1997-01-01\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "agent builds a profile for an account-less person" "$c" 201
MANAGED=$(field /tmp/body id)

c=$(req GET /agents/profiles "" "$AGENT")
check "agent lists the profiles they steward" "$c" 200
grep -q "$MANAGED" /tmp/body && { echo "  PASS  agent sees their own managed profile"; PASS=$((PASS+1)); } || { echo "  FAIL  agent cannot see own managed profile"; FAIL=$((FAIL+1)); }

c=$(req GET /agents/profiles "" "$AGENT2")
grep -q '"total":0' /tmp/body && { echo "  PASS  second agent has an empty book"; PASS=$((PASS+1)); } || { echo "  FAIL  second agent book leaked: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }
c=$(req GET "/agents/profiles/$MANAGED" "" "$AGENT2")
check "second agent cannot read that profile" "$c" 403

c=$(req GET /matches/suggestions "" "$AGENT")
check "agent must name a profile to browse" "$c" 400
c=$(req GET "/matches/suggestions?profileId=$MANAGED" "" "$AGENT")
check "agent browses as the profile they steward" "$c" 200
c=$(req GET "/matches/suggestions?profileId=$MANAGED" "" "$AGENT2")
check "second agent cannot browse as that profile" "$c" 403

# Profile ids for the individuals, since interests are keyed on profiles now.
# Matchmaking is gated on a completed profile now, so fill both in before
# anything tries to browse or send an interest.
PREFS='{"religion":"hindu","community":"kamma","preferredAgeMin":24,"preferredAgeMax":34,"preferredLocations":["Hyderabad"]}'
req PUT /users/me/profile "{\"displayName\":\"Groom $STAMP\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS}" "$GROOM" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Bride $STAMP\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null

c=$(req GET /users/me "" "$GROOM")
GROOM_PROFILE=$(field /tmp/body id)
c=$(req GET /users/me "" "$BRIDE")
BRIDE_PROFILE=$(field /tmp/body id)

c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\",\"profileId\":\"$MANAGED\"}" "$AGENT2")
check "second agent cannot send interest from that profile" "$c" 403
c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\",\"profileId\":\"$MANAGED\"}" "$AGENT")
check "agent sends interest for the profile they steward" "$c" 201

# Invite the subject so an actual account exists for the booking checks below.
c=$(req POST "/agents/profiles/$MANAGED/invite" "" "$AGENT")
check "agent emails the invitation" "$c" 201
INVITE_TOKEN=$(field /tmp/body devToken)
if [ -n "$INVITE_TOKEN" ]; then
  c=$(req POST /auth/invitations/accept "{\"token\":\"$INVITE_TOKEN\",\"password\":\"ClientPass1\"}")
  check "the subject claims the profile and gets an account" "$c" 201
  CLIENT_ID=$(jq -r '.user.id' /tmp/body)
  c=$(req GET /agents/clients "" "$AGENT")
  check "the new account appears on the agent book" "$c" 200
  c=$(req GET "/agents/clients/$CLIENT_ID" "" "$AGENT2")
  check "second agent cannot read that client" "$c" 403
else
  echo "  NOTE  no devToken (MAIL_PROVIDER is not 'log'); skipping claim-dependent checks"
  CLIENT_ID=""
fi

echo "== 6. Independent user may approach any user or agent =="
c=$(req POST /matches/interest "{\"toProfileId\":\"$MANAGED\"}" "$BRIDE")
check "independent user approaches an agent-built profile" "$c" 201
c=$(req POST /chat/messages "{\"toUserId\":\"$AGENT_ID\",\"body\":\"Hello, can you help?\"}" "$BRIDE")
check "independent user messages any agent" "$c" 201
c=$(req POST /chat/messages "{\"toUserId\":\"$GROOM_ID\",\"body\":\"hi\"}" "$BRIDE")
check "user cannot message an unmatched individual" "$c" 403

echo
echo "== 6b. Match Fixed: two confirmations, then the marketplace opens =="
c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\"}" "$BRIDE")
check "bride sends the groom an interest" "$c" 201
FIXED_INTEREST=$(field /tmp/body id)
c=$(req PUT "/matches/$FIXED_INTEREST/accept" "" "$GROOM")
check "groom accepts" "$c" 200

# Services are locked until the match is fixed. This is the gate, checked
# before it opens rather than only after.
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$BRIDE_PROFILE\",\"amount\":5000}" "$BRIDE")
check "services are locked before the match is fixed" "$c" 403

c=$(req PUT "/matches/$FIXED_INTEREST/match-fixed" "" "$BRIDE")
check "bride confirms her side" "$c" 200
grep -q '"state":"pending_confirmation"' /tmp/body && { echo "  PASS  one confirmation is not enough"; PASS=$((PASS+1)); } || { echo "  FAIL  one side confirming already fixed the match: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }
c=$(req PUT "/matches/$FIXED_INTEREST/match-fixed" "" "$BRIDE")
check "the same side cannot confirm twice" "$c" 400

c=$(req PUT "/matches/$FIXED_INTEREST/match-fixed" "" "$GROOM")
check "groom confirms and the match is fixed" "$c" 200
grep -q '"state":"confirmed"' /tmp/body && { echo "  PASS  both confirmations fix the match"; PASS=$((PASS+1)); } || { echo "  FAIL  match not confirmed: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }

c=$(req GET /matches/suggestions "" "$BRIDE")
check "matchmaking closes once the match is fixed" "$c" 403
c=$(req GET /matches/status "" "$BRIDE")
check "the dashboard reports the fixed match" "$c" 200
grep -q '"servicesUnlocked":true' /tmp/body && { echo "  PASS  services report as unlocked"; PASS=$((PASS+1)); } || { echo "  FAIL  services still locked after the fix: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }
c=$(req PUT "/matches/$FIXED_INTEREST/unmatch" '{"reason":"changed our minds"}' "$BRIDE")
check "a fixed match cannot be quietly unmatched" "$c" 400

echo
echo "== 7. Booking IDOR and escrow lifecycle =="
c=$(req POST /vendors "{\"name\":\"Venue $STAMP\",\"category\":\"venue\",\"city\":\"Hyderabad\"}" "$VENDOR")
check "vendor creates a listing" "$c" 201
LISTING=$(field /tmp/body id)
grep -q '"isApproved":false' /tmp/body && { echo "  PASS  new listing starts unapproved"; PASS=$((PASS+1)); } || { echo "  FAIL  new listing not unapproved"; FAIL=$((FAIL+1)); }

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":5000}" "$BRIDE")
check "cannot book an unapproved listing" "$c" 400
c=$(req PUT "/admin/vendors/$LISTING/approve" "" "$ADMIN")
check "admin approves the listing" "$c" 200
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":5000}" "$BRIDE")
check "bride books the approved vendor" "$c" 201
BOOKING=$(field /tmp/body id)

c=$(req PUT "/bookings/$BOOKING/complete" "" "$GROOM")
check "unrelated user cannot complete (escrow release)" "$c" 403
c=$(req PUT "/bookings/$BOOKING/cancel" '{}' "$GROOM")
check "unrelated user cannot cancel (escrow refund)" "$c" 403
c=$(req PUT "/bookings/$BOOKING/pay" "" "$GROOM")
check "unrelated user cannot pay" "$c" 403
c=$(req PUT "/bookings/$BOOKING/confirm" "" "$PLANNER")
check "a different provider cannot confirm" "$c" 403
c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "provider cannot complete before confirm" "$c" 400

c=$(req PUT "/bookings/$BOOKING/pay" "" "$BRIDE")
check "buyer pays into escrow" "$c" 200
c=$(req PUT "/bookings/$BOOKING/confirm" "" "$VENDOR")
check "owning vendor confirms" "$c" 200
c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "owning vendor completes" "$c" 200
c=$(req PUT "/bookings/$BOOKING/confirm" "" "$VENDOR")
check "no transition out of COMPLETED" "$c" 400

c=$(req GET /bookings/incoming "" "$VENDOR")
check "vendor lists incoming bookings" "$c" 200
c=$(req GET /bookings/incoming "" "$BRIDE")
check "bride cannot list incoming bookings" "$c" 403

echo
echo "== 8. Agent books on behalf of a client =="
if [ -z "$CLIENT_ID" ]; then
  echo "  NOTE  no claimed client available; skipping on-behalf-of booking checks"
else
  # The lock follows the client, not the person clicking, so the agent has to
  # fix their client's match before booking anything for them. An agency
  # matching two of its own clients is the ordinary case here, and the agent
  # confirms both sides because neither client has an account.
  c=$(req POST /agents/profiles "{\"displayName\":\"Partner $STAMP\",\"contactEmail\":\"partner-$STAMP@t.com\",\"contactPhone\":\"$(phone 005)\",\"gender\":\"male\",\"dateOfBirth\":\"1995-05-05\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
  check "agent builds the counterpart profile" "$c" 201
  PARTNER=$(field /tmp/body id)

  c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":2500,\"onBehalfOfUserId\":\"$CLIENT_ID\"}" "$AGENT")
  check "agent cannot book for a client with no fixed match" "$c" 403

  c=$(req POST /matches/interest "{\"toProfileId\":\"$PARTNER\",\"profileId\":\"$MANAGED\"}" "$AGENT")
  check "agent introduces two of their own clients" "$c" 201
  CLIENT_INTEREST=$(field /tmp/body id)
  c=$(req PUT "/matches/$CLIENT_INTEREST/accept" "" "$AGENT")
  check "agent records the acceptance" "$c" 200
  c=$(req PUT "/matches/$CLIENT_INTEREST/match-fixed" "" "$AGENT")
  check "agent confirms the first side" "$c" 200
  c=$(req PUT "/matches/$CLIENT_INTEREST/match-fixed" "" "$AGENT")
  check "agent confirms the second side" "$c" 200
  grep -q '"state":"confirmed"' /tmp/body && { echo "  PASS  the agent-brokered match is fixed"; PASS=$((PASS+1)); } || { echo "  FAIL  agent-brokered match not fixed: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }

  c=$(req GET "/agents/profiles/$MANAGED/charges" "" "$AGENT")
  check "the agency ledger lists the client's charges" "$c" 200
  grep -q '"match_settlement"' /tmp/body && { echo "  PASS  the success fee is raised when the match is fixed"; PASS=$((PASS+1)); } || { echo "  FAIL  no settlement fee raised: $(head -c 200 /tmp/body)"; FAIL=$((FAIL+1)); }
  c=$(req GET "/agents/profiles/$MANAGED/charges" "" "$AGENT2")
  check "another agency cannot read those charges" "$c" 403

  c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":2500,\"onBehalfOfUserId\":\"$CLIENT_ID\"}" "$AGENT")
  check "agent books for their client" "$c" 201
  grep -q "\"userId\":\"$CLIENT_ID\"" /tmp/body && { echo "  PASS  booking is owned by the client"; PASS=$((PASS+1)); } || { echo "  FAIL  booking not owned by client"; FAIL=$((FAIL+1)); }
  grep -q "\"bookedByUserId\":\"$AGENT_ID\"" /tmp/body && { echo "  PASS  acting agent recorded on the booking"; PASS=$((PASS+1)); } || { echo "  FAIL  acting agent not recorded"; FAIL=$((FAIL+1)); }

  c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":2500,\"onBehalfOfUserId\":\"$CLIENT_ID\"}" "$AGENT2")
  check "another agent cannot book for that client" "$c" 403
  c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":2500,\"onBehalfOfUserId\":\"$CLIENT_ID\"}" "$BRIDE")
  check "a plain user cannot book on behalf of anyone" "$c" 403
fi

echo "== 9. Planner persona: listing, approval, booking =="
c=$(req PUT /wedding-planners/me "{\"agencyName\":\"Everafter $STAMP\",\"city\":\"Hyderabad\",\"yearsExperience\":7}" "$PLANNER")
check "planner creates their listing" "$c" 200
PLISTING=$(field /tmp/body id)
c=$(req PUT "/admin/planners/$PLISTING/approve" "" "$ADMIN")
check "admin approves the planner" "$c" 200
c=$(req POST /bookings "{\"providerType\":\"planner\",\"providerId\":\"$PLISTING\",\"amount\":9000}" "$BRIDE")
check "bride books a wedding planner" "$c" 201
PBOOKING=$(field /tmp/body id)
c=$(req PUT "/bookings/$PBOOKING/confirm" "" "$VENDOR")
check "a vendor cannot confirm a planner booking" "$c" 403
c=$(req PUT "/bookings/$PBOOKING/pay" "" "$BRIDE")
check "buyer pays the planner booking" "$c" 200
c=$(req PUT "/bookings/$PBOOKING/confirm" "" "$PLANNER")
check "the owning planner confirms" "$c" 200

echo
echo "== 10. Reviews gated on a completed booking =="
c=$(req POST "/vendors/$LISTING/reviews" '{"rating":5,"comment":"Great"}' "$GROOM")
check "user with no booking cannot review" "$c" 403
c=$(req POST "/vendors/$LISTING/reviews" '{"rating":5,"comment":"Great"}' "$BRIDE")
check "buyer who completed can review" "$c" 201
c=$(req POST "/vendors/$LISTING/reviews" '{"rating":9}' "$BRIDE")
check "out-of-range rating rejected" "$c" 400
c=$(req POST "/vendors/$LISTING/reviews" '{"rating":5}' "$VENDOR")
check "vendor cannot review (no review permission)" "$c" 403

echo
echo "== 11. Events IDOR =="
c=$(req POST /events '{"name":"Mehendi","venue":"Hall A"}' "$BRIDE")
check "bride creates an event" "$c" 201
EV=$(field /tmp/body id)
c=$(req GET "/events/$EV/guest-list" "" "$GROOM")
check "another user cannot read the guest list" "$c" 403
c=$(req GET "/events/$EV/guest-list" "" "$BRIDE")
check "the host can read the guest list" "$c" 200
c=$(req POST /events/guests '{"name":"Guest One"}' "$GROOM")
check "groom adds their own guest" "$c" 201
G=$(field /tmp/body id)
c=$(req POST "/events/$EV/invite" "{\"guestId\":\"$G\"}" "$BRIDE")
check "host cannot invite another user guest record" "$c" 403

echo
echo "== 12. Request schema validation =="
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"not-a-uuid\",\"amount\":5000}" "$BRIDE")
check "non-uuid providerId rejected" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":-50}" "$BRIDE")
check "negative amount rejected" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"satellite\",\"providerId\":\"$LISTING\",\"amount\":50}" "$BRIDE")
check "unknown providerType rejected" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":999999999999}" "$BRIDE")
check "absurd amount rejected" "$c" 400
c=$(req POST /admin/disputes "{\"bookingId\":\"$BOOKING\",\"reason\":\"x\"}" "$BRIDE")
check "too-short dispute reason rejected" "$c" 400
c=$(req POST /admin/disputes "{\"bookingId\":\"$BOOKING\",\"reason\":\"The venue was not as described at all.\"}" "$GROOM")
check "dispute by a non-party rejected" "$c" 403
c=$(req POST /admin/disputes "{\"bookingId\":\"$BOOKING\",\"reason\":\"The venue was not as described at all.\"}" "$BRIDE")
check "dispute by the buyer accepted" "$c" 201
c=$(req POST "/media/albums/$FAKE/presign" '{"filename":"../../etc/passwd"}' "$BRIDE")
check "path traversal in presign filename rejected" "$c" 400
c=$(req PUT /users/me/profile '{"displayName":"A","photos":["javascript:alert(1)"]}' "$BRIDE")
check "non-url photo rejected" "$c" 400
c=$(req GET "/vendors/search?limit=100000" "")
check "oversized page limit rejected" "$c" 400

echo
echo "== 13. Token handling =="
c=$(req GET /auth/me/permissions "" "garbage.token.here")
check "garbage token rejected" "$c" 401
c=$(req GET /auth/me/permissions "")
check "missing token rejected" "$c" 401
# The refresh token is in the httpOnly cookie the jar picked up at login, not
# in the response body — which is the point: page script cannot read it.
grep -q "$(printf 'wow_rt')" "$JAR" && { echo "  PASS  refresh token is set as an httpOnly cookie"; PASS=$((PASS+1)); } || { echo "  FAIL  no refresh cookie was set"; FAIL=$((FAIL+1)); }
jq -e 'has("refreshToken") | not' /tmp/bride.json >/dev/null && { echo "  PASS  refresh token is NOT returned in the JSON body"; PASS=$((PASS+1)); } || { echo "  FAIL  refresh token leaked into the response body"; FAIL=$((FAIL+1)); }

c=$(req POST /auth/refresh '{}')
check "refresh works from the cookie alone, with no access token" "$c" 200
# Explicit body token beats the cookie, so a tampered one is still rejected.
c=$(curl -s -o /tmp/body -w '%{http_code}' -X POST "$API/auth/refresh" \
      -H 'Content-Type: application/json' -d '{"refreshToken":"tampered.token.value.here"}')
check "tampered refresh token rejected" "$c" 401
c=$(req PUT "/admin/users/$BRIDE_ID/status" '{"isActive":false}' "$ADMIN")
check "admin deactivates an account" "$c" 200
c=$(req GET /auth/me/permissions "" "$BRIDE")
check "deactivated user blocked on an existing token" "$c" 403
c=$(req PUT "/admin/users/$BRIDE_ID/status" '{"isActive":true}' "$ADMIN")
check "admin reinstates the account" "$c" 200
c=$(req GET /auth/me/permissions "" "$BRIDE")
check "reinstated user works again" "$c" 200

echo
echo "============================="
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
echo "============================="
[ "$FAIL" = "0" ]
