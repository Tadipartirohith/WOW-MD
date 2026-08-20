#!/bin/sh
# Live verification of the Phase 1 implementation: In-Person verification,
# support cases and frozen escrow, Match Fixed and customer provisioning,
# staged escrow milestones, quotations, vendor availability, identity documents,
# chat redaction and the profile lifecycle.
#
# Runs from inside the compose network, same as the other suites:
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" \
#     alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-phase1.sh"
#
# Needs MAIL_PROVIDER=log: in that mode invitation links and the temporary
# passwords for provisioned accounts come back on the response, because nothing
# is actually delivered.
API=${API:-http://backend:3000/api}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@wow.example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-AdminLocalDev2026!}
PASS=0
FAIL=0
STAMP=$(head -c 8 /proc/sys/kernel/random/uuid | tr -d '-')

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
    printf '  PASS  %s (HTTP %s)\n' "$name" "$actual"; PASS=$((PASS + 1))
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
    printf '  FAIL  %s %s\n' "$name" "$(head -c 250 /tmp/body)"; FAIL=$((FAIL + 1))
  fi
}

body_has() { grep -q "$1" /tmp/body && assert "$2" 1 || assert "$2" 0; }
field() { jq -r ".$2 // empty" "$1"; }

CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","allowsCirculation":true}'

# Unique per run: the identity hash and the client phone number both carry
# uniqueness constraints, by design, so re-running must not collide with the
# previous run's rows.
PHONE_BASE=$(date +%s | tail -c 7)
phone() { echo "+919${PHONE_BASE}$1"; }
# An Aadhaar number carries a Verhoeff check digit, so a valid one cannot be
# generated in shell. This fixed one is only ever used to prove that an invalid
# number is refused — nothing stores it. The documents that DO get stored are
# passports, whose format is simple enough to vary per run, which matters
# because the identity hash is unique platform-wide by design.
BAD_AADHAAR=123456789012
PASSPORT_A="A1$(echo "$PHONE_BASE" | tail -c 7)"
PASSPORT_B="B2$(echo "$PHONE_BASE" | tail -c 7)"
# A GST number identifies one business, so it is unique platform-wide too.
GST="29ABCDE$(echo "$PHONE_BASE" | tail -c 5)F1Z5"

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

reg() {
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"Test $key\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}

echo
echo "== 1. Personas =="
reg bride individual bride
reg groom individual groom
reg agent agent ""
reg vendor vendor ""
BRIDE=$(field /tmp/bride.json accessToken)
GROOM=$(field /tmp/groom.json accessToken)
AGENT=$(field /tmp/agent.json accessToken)
VENDOR=$(field /tmp/vendor.json accessToken)
BRIDE_ID=$(jq -r '.user.id' /tmp/bride.json)
GROOM_ID=$(jq -r '.user.id' /tmp/groom.json)

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin signs in" "$c" 200
ADMIN=$(field /tmp/body accessToken)

echo
echo "== 2. In-Person officers exist only because an admin created them =="
c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Officer $STAMP\",\"region\":\"Hyderabad\"}" "$BRIDE")
check "a user cannot create a verification officer" "$c" 403
c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Officer $STAMP\",\"region\":\"Hyderabad\"}" "$AGENT")
check "an agent cannot create a verification officer" "$c" 403

c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Officer $STAMP\",\"region\":\"Hyderabad\"}" "$ADMIN")
check "admin creates a verification officer" "$c" 201
OFFICER_ID=$(field /tmp/body id)
OFFICER_TEMP=$(field /tmp/body devPassword)
[ -n "$OFFICER_TEMP" ] && assert "the temporary password comes back in log-mail mode" 1 || assert "no temporary password returned" 0

c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Duplicate\"}" "$ADMIN")
check "the same email cannot be used twice" "$c" 409

echo
echo "== 3. A provisioned account is locked to the password reset =="
c=$(req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"$OFFICER_TEMP\"}")
check "officer signs in with the temporary password" "$c" 200
OFFICER=$(field /tmp/body accessToken)
body_has '"mustResetPassword":true' "the response says the password must be replaced"

c=$(req GET /verification/requests "" "$OFFICER")
check "every other route is refused while the temporary password stands" "$c" 403
body_has 'PASSWORD_RESET_REQUIRED' "the refusal carries a code the client can branch on"

c=$(req POST /auth/password/change "{\"currentPassword\":\"$OFFICER_TEMP\",\"newPassword\":\"OfficerPass1\"}" "$OFFICER")
check "the password change itself is allowed through" "$c" 200
c=$(req GET /verification/requests "" "$OFFICER")
check "the old session is terminated by the change" "$c" 401

c=$(req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"OfficerPass1\"}")
check "officer signs in again with their own password" "$c" 200
OFFICER=$(field /tmp/body accessToken)
c=$(req GET /verification/requests "" "$OFFICER")
check "and now has their queue" "$c" 200

echo
echo "== 4. Registration queues a visit; it does not grant access =="
c=$(req PUT /agents/agency "{\"agencyName\":\"Agency $STAMP\",\"city\":\"Hyderabad\"}" "$AGENT")
check "agent submits their agency details" "$c" 200
AGENCY=$(field /tmp/body id)
body_has '"isApproved":false' "the agency is not approved by submitting a form"

c=$(req GET /verification/me "" "$AGENT")
check "the agent can see where their verification stands" "$c" 200
body_has '"status":"new"' "a request was raised and is waiting for allocation"
REQ=$(field /tmp/body id)

c=$(req POST /agents/profiles "{\"displayName\":\"Too Early\",\"contactPhone\":\"$(phone 001)\",$CONSENT}" "$AGENT")
check "an unverified agency still cannot build profiles" "$c" 403

c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$AGENT")
check "an applicant cannot approve themselves" "$c" 403
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "an officer cannot decide a request that is not allocated to them" "$c" 403
c=$(req PUT "/verification/requests/$REQ/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$OFFICER")
check "an officer cannot allocate work to themselves" "$c" 403

c=$(req PUT "/verification/requests/$REQ/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates the visit" "$c" 200
c=$(req PUT "/verification/requests/$REQ/start" "" "$OFFICER")
check "officer picks it up" "$c" 200
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"rejected"}' "$OFFICER")
check "a rejection without a reason is refused" "$c" 400
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "officer approves after the visit" "$c" 200

c=$(req GET /agents/agency "" "$AGENT")
body_has '"isApproved":true' "the approval activated the agency"
c=$(req POST /agents/profiles "{\"displayName\":\"Client $STAMP\",\"contactEmail\":\"client-$STAMP@t.com\",\"contactPhone\":\"$(phone 002)\",\"gender\":\"female\",\"dateOfBirth\":\"1997-01-01\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "and the agency can now build profiles" "$c" 201
MANAGED=$(field /tmp/body id)

echo
echo "== 5. Identity documents, and the duplicate they catch =="
c=$(req POST "/users/profiles/$MANAGED/identity" "{\"idType\":\"aadhaar\",\"idNumber\":\"$BAD_AADHAAR\"}" "$AGENT")
check "an Aadhaar number that fails its checksum is refused" "$c" 400
c=$(req POST "/users/profiles/$MANAGED/identity" "{\"idType\":\"passport\",\"idNumber\":\"$PASSPORT_A\"}" "$AGENT")
check "agent records the client's identity document" "$c" 201
body_has "\"last4\":\"$(echo "$PASSPORT_A" | tail -c 5)\"" "only the last four characters are kept"

c=$(req POST /agents/profiles "{\"displayName\":\"Partner $STAMP\",\"contactPhone\":\"$(phone 003)\",\"gender\":\"male\",\"dateOfBirth\":\"1995-05-05\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "agent builds the counterpart profile" "$c" 201
PARTNER=$(field /tmp/body id)
c=$(req POST "/users/profiles/$PARTNER/identity" "{\"idType\":\"passport\",\"idNumber\":\"$PASSPORT_A\"}" "$AGENT")
check "the same document cannot back a second profile" "$c" 409
c=$(req POST "/users/profiles/$PARTNER/identity" "{\"idType\":\"passport\",\"idNumber\":\"$PASSPORT_B\"}" "$AGENT")
check "a different document is accepted" "$c" 201

c=$(req PUT "/verification/identity/$MANAGED/verify" "" "$AGENT")
check "an agent cannot confirm their own client's document" "$c" 403
c=$(req PUT "/verification/identity/$MANAGED/verify" "" "$OFFICER")
check "the officer who saw it confirms it" "$c" 200
body_has '"verifiedAt"' "the confirmation is recorded"

echo
echo "== 6. Agency fees follow the outcome =="
c=$(req GET "/agents/profiles/$MANAGED/charges" "" "$AGENT")
check "the client's charges are readable" "$c" 200
body_has '"profile_creation"' "taking a client on raises the profile fee"
CHARGE=$(jq -r '.[0].id' /tmp/body)
c=$(req PUT "/agents/charges/$CHARGE/pay" "" "$AGENT")
check "the agency records the client's payment" "$c" 200
body_has '"status":"held_in_escrow"' "the fee is held in escrow, not paid straight out"

c=$(req GET /agents/billing "" "$AGENT")
check "the agency ledger is readable" "$c" 200
body_has '"inEscrow"' "the ledger reports what is being held"

echo
echo "== 7. Match Fixed provisions the customer account =="
c=$(req POST /matches/interest "{\"toProfileId\":\"$PARTNER\",\"profileId\":\"$MANAGED\"}" "$AGENT")
check "agent introduces two of their own clients" "$c" 201
INTEREST=$(field /tmp/body id)
c=$(req PUT "/matches/$INTEREST/accept" "" "$AGENT")
check "agent records the acceptance" "$c" 200
c=$(req PUT "/matches/$INTEREST/match-fixed" '{"side":"from"}' "$AGENT")
check "agent confirms the bride's side" "$c" 200
body_has '"state":"pending_confirmation"' "one confirmation leaves it pending"
c=$(req PUT "/matches/$INTEREST/match-fixed" '{"side":"to"}' "$AGENT")
check "agent confirms the groom's side" "$c" 200
body_has '"state":"confirmed"' "two confirmations fix the match"

c=$(req GET "/admin/users?limit=100" "" "$ADMIN")
grep -q "client-$STAMP@t.com" /tmp/body && assert "an account was created for the client who never had one" 1 || assert "no account provisioned for the client" 0

c=$(req GET "/agents/profiles/$MANAGED/charges" "" "$AGENT")
body_has '"match_settlement"' "the success fee falls due when the match is fixed"
body_has '"status":"released"' "and the money held in escrow is released to the agency"

c=$(req GET "/matches/suggestions?profileId=$MANAGED" "" "$AGENT")
check "matchmaking closes for a fixed profile" "$c" 403

echo
echo "== 8. Vendor compliance, quotations and the calendar =="
c=$(req POST /vendors "{\"name\":\"Venue $STAMP\",\"category\":\"venue\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GST\",\"panNumber\":\"ABCDE1234F\",\"registeredAddress\":\"12 Banjara Hills, Hyderabad\"}" "$VENDOR")
check "vendor lists with compliance details" "$c" 201
LISTING=$(field /tmp/body id)
c=$(req POST /vendors "{\"name\":\"Bad GST\",\"category\":\"venue\",\"gstNumber\":\"NOTAGST\"}" "$VENDOR")
check "a malformed GST number is refused" "$c" 400

c=$(req GET /verification/me "" "$VENDOR")
body_has '"applicantType":"vendor"' "listing queued the vendor for a visit too"

c=$(req PUT "/admin/vendors/$LISTING/approve" "" "$ADMIN")
check "admin approves the listing" "$c" 200

# The bride needs a fixed match of her own before services open to her.
PREFS='{"religion":"hindu","education":"masters","lifestyle":["vegetarian","non-smoker"]}'
req PUT /users/me/profile "{\"displayName\":\"Bride $STAMP\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Groom $STAMP\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$GROOM" >/dev/null
c=$(req GET /users/me "" "$GROOM")
GROOM_PROFILE=$(field /tmp/body id)

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":100000,\"eventDate\":\"2027-02-14\"}" "$BRIDE")
check "services are locked before the bride's match is fixed" "$c" 403

c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\"}" "$BRIDE")
check "bride sends the groom an interest" "$c" 201
BG=$(field /tmp/body id)
c=$(req PUT "/matches/$BG/accept" "" "$GROOM")
check "groom accepts" "$c" 200
c=$(req PUT "/matches/$BG/match-fixed" "" "$BRIDE")
check "bride confirms" "$c" 200
c=$(req PUT "/matches/$BG/match-fixed" "" "$GROOM")
check "groom confirms and their match is fixed" "$c" 200

c=$(req PUT "/vendors/$LISTING/availability" '{"date":"2027-02-14","capacity":0,"note":"already committed"}' "$VENDOR")
check "vendor blocks a date out" "$c" 200
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":100000,\"eventDate\":\"2027-02-14\"}" "$BRIDE")
check "a blocked date cannot be booked" "$c" 400
c=$(req PUT "/vendors/$LISTING/availability" '{"date":"2027-02-14","capacity":1}' "$VENDOR")
check "vendor opens the date again" "$c" 200

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":100000,\"eventDate\":\"2027-02-14\"}" "$BRIDE")
check "bride sends the request" "$c" 201
BOOKING=$(field /tmp/body id)
body_has '"status":"requested"' "a request starts unpriced"

c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":20000}]}' "$VENDOR")
check "line items that do not add up are refused" "$c" 400
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":30000}]}' "$BRIDE")
check "the buyer cannot quote to themselves" "$c" 403
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":30000}]}' "$VENDOR")
check "vendor quotes for the job" "$c" 201
QUOTE=$(field /tmp/body id)

c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":85000}' "$VENDOR")
check "vendor re-quotes" "$c" 201
QUOTE2=$(field /tmp/body id)
c=$(req PUT "/bookings/quotations/$QUOTE/accept" '{}' "$BRIDE")
check "the superseded quotation can no longer be accepted" "$c" 400
c=$(req PUT "/bookings/quotations/$QUOTE2/accept" '{}' "$VENDOR")
check "the vendor cannot accept on the buyer's behalf" "$c" 403
c=$(req PUT "/bookings/quotations/$QUOTE2/accept" '{}' "$BRIDE")
check "bride accepts the live quotation" "$c" 200
body_has '"status":"payment_pending"' "acceptance moves the booking to payment pending"
body_has '"amount":"85000.00"' "and the accepted price is what the booking now carries"

echo
echo "== 9. Escrow in three instalments =="
c=$(req GET "/bookings/$BOOKING/milestones" "" "$BRIDE")
check "the instalments are listed" "$c" 200
body_has '"amount":"25500.00"' "the advance is 30% of the accepted price"
body_has '"amount":"34000.00"' "and the balance is the remainder, not a third percentage"

c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"final"}' "$BRIDE")
check "the balance cannot be paid before the deposit" "$c" 400
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "bride pays the advance" "$c" 200
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "the same instalment cannot be paid twice" "$c" 400
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"second"}' "$BRIDE")
check "bride pays the second instalment" "$c" 200
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"final"}' "$BRIDE")
check "bride pays the balance" "$c" 200

c=$(req PUT "/bookings/$BOOKING/confirm" "" "$VENDOR")
check "vendor confirms and takes the date" "$c" 200
c=$(req PUT "/bookings/$BOOKING/start" "" "$VENDOR")
check "vendor marks work started" "$c" 200

echo
echo "== 10. A case freezes the money until somebody decides =="
c=$(req POST /verification/cases "{\"subjectType\":\"booking\",\"subjectId\":\"$BOOKING\",\"title\":\"Venue not as described\",\"description\":\"The hall shown at the visit is not the hall we were given.\"}" "$BRIDE")
check "bride raises a case against the booking" "$c" 201
CASE=$(field /tmp/body id)

c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "the provider cannot release the money while the case is open" "$c" 400
c=$(req PUT "/bookings/$BOOKING/cancel" '{"reason":"forget it"}' "$BRIDE")
check "nor can the buyer refund it out from under the case" "$c" 400

c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"release"}' "$BRIDE")
check "the person who raised it cannot settle it" "$c" 403
c=$(req PUT "/verification/cases/$CASE/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates the case" "$c" 200
c=$(req PUT "/verification/cases/$CASE/findings" '{"findings":"Visited the venue. The hall matches the listing photographs."}' "$OFFICER")
check "officer records what they found" "$c" 200
c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"partial"}' "$OFFICER")
check "a partial settlement needs the amount" "$c" 400
c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"release","notes":"Provider delivered as described."}' "$OFFICER")
check "officer settles in the provider's favour" "$c" 200

c=$(req GET "/bookings/$BOOKING/milestones" "" "$BRIDE")
body_has '"status":"released"' "the settlement is what moved the money"

echo
echo "== 11. Chat keeps the conversation on the platform =="
c=$(req POST /chat/messages "{\"toUserId\":\"$GROOM_ID\",\"body\":\"Lovely to match. Call me on 9876543210 or mail me at me@example.com\"}" "$BRIDE")
check "bride messages her match" "$c" 201
body_has 'contact removed' "the phone number and address are stripped before storage"
c=$(req GET "/chat/messages?withUserId=$BRIDE_ID" "" "$GROOM")
check "groom reads the thread" "$c" 200
grep -q '9876543210' /tmp/body && assert "a number leaked into the stored message" 0 || assert "no contact number survives in the thread" 1

echo
echo "== 12. The profile lifecycle =="
c=$(req POST /agents/profiles "{\"displayName\":\"Paused $STAMP\",\"contactPhone\":\"$(phone 004)\",\"gender\":\"female\",\"dateOfBirth\":\"1998-08-08\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "agent builds one more profile" "$c" 201
PAUSED=$(field /tmp/body id)

c=$(req PUT "/agents/profiles/$PAUSED/deactivate" '{"reason":"family travelling"}' "$AGENT")
check "agent pauses it at the client's request" "$c" 200
body_has '"lifecycle":"deactivated"' "the profile reports as paused"
c=$(req GET "/matches/suggestions?profileId=$PAUSED" "" "$AGENT")
check "a paused profile does not matchmake" "$c" 403
c=$(req PUT "/agents/profiles/$PAUSED/reactivate" "" "$AGENT")
check "agent brings it back" "$c" 200

c=$(req PUT "/agents/profiles/$PAUSED/archive" '{"reason":"married elsewhere"}' "$AGENT")
check "agent closes the engagement out" "$c" 200
body_has '"lifecycle":"archived"' "the profile reports as archived"
c=$(req PUT "/agents/profiles/$PAUSED/reactivate" "" "$AGENT")
check "an archived profile cannot be revived" "$c" 400
c=$(req GET "/agents/profiles/$PAUSED" "" "$AGENT")
check "but the record survives for the audit trail" "$c" 200

echo
echo "== 13. The administrator's dashboard =="
c=$(req GET /admin/analytics "" "$ADMIN")
check "admin reads the dashboard" "$c" 200
body_has '"verification"' "it reports the verification queue"
body_has '"matchesFixed"' "it reports matches fixed"
body_has '"escrow"' "it reports where the money sits"
body_has '"agencyFees"' "including the agency ledger"
c=$(req GET /admin/analytics "" "$VENDOR")
check "a vendor cannot read it" "$c" 403

c=$(req GET /verification/workload "" "$ADMIN")
check "admin sees officer workload for allocation" "$c" 200
c=$(req GET /verification/metrics "" "$OFFICER")
check "the officer sees their own counters" "$c" 200

echo
echo "============================="
echo " PASSED: $PASS   FAILED: $FAIL"
echo "============================="
[ "$FAIL" -eq 0 ] || exit 1
