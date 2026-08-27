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

# Identity verification now gates sending an interest, accepting one and
# fixing a match. Every persona that does any of those has to go through it
# first — the gate itself is asserted in verify-phase2.
. /scripts/lib-identity.sh


# A business now has a life rather than a boolean, so getting one live means
# walking the path a vendor actually walks: fill in the catalog, look it over,
# submit, then allocate, visit and decide. Skipping to "approved" is refused,
# which is the point of the state machine.
#
#   go_live <businessToken> <businessId> <adminToken> <officerId> <officerToken>
FINDINGS_JSON='{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}'

# The catalog is configuration, so a service asks whatever an administrator
# decided it should ask. The helper therefore reads the form and answers it,
# rather than assuming a shape — which is the same reason the form exists.
answers_for() { # answers_for <serviceForm json on stdin>
  jq -c '[.[] | select(.required)] | map({(.key): (
      if   .type == "boolean"       then true
      elif .type == "single_select" then (.constraints.options[0].value // "other")
      elif .type == "multi_select"  then [(.constraints.options[0].value // "other")]
      elif .type == "date"          then "2027-01-01"
      elif .type == "time"          then "10:00"
      elif .type == "date_time"     then "2027-01-01T10:00:00.000Z"
      elif .type == "url"           then "https://example.com/portfolio"
      elif (.type == "number" or .type == "decimal" or .type == "currency"
            or .type == "duration" or .type == "range")
                                    then (.constraints.min // 1)
      else "Not specified" end)}) | add // {}'
}

seed_catalog() { # seed_catalog <token> <businessId>
  req GET /catalog/categories "" "$1" >/dev/null
  cat_ids=$(jq -r '.[].id' /tmp/body)
  # An empty catalog is a setup problem, not a test failure, and it used to
  # look like one six assertions later: this returned quietly, the business got
  # no priced service, and the suite reported "Finish these first: Catalog
  # services" from somewhere else entirely. Say it here, where it is true.
  if [ -z "$cat_ids" ]; then
    echo "  FAIL  the service catalog is empty — run the catalog seed first:" >&2
    echo "        docker compose -f docker/docker-compose.yml --profile seed run --rm seed-catalog" >&2
    FAIL=$((FAIL + 1))
    return 1
  fi

  for cat_id in $cat_ids; do
    req GET "/catalog/categories/$cat_id/services" "" "$1" >/dev/null
    def_ids=$(jq -r '.[].id' /tmp/body)
    for def_id in $def_ids; do
      req GET "/catalog/services/$def_id" "" "$1" >/dev/null
      def_json=$(cat /tmp/body)
      attrs=$(echo "$def_json" | jq -c '.serviceForm' | answers_for)
      req POST "/vendors/$2/services" "{\"definitionId\":\"$def_id\",\"attributes\":$attrs}" "$1" >/dev/null
      svc_id=$(jq -r '.id // empty' /tmp/body)
      [ -z "$svc_id" ] && continue

      # The definition decides which pricing models a service may use, so the
      # price is built from that rather than assumed. Quote-only models carry
      # no amount; everything else does.
      model=$(echo "$def_json" | jq -r '.definition.allowedPricingModels[0] // "fixed"')
      case "$model" in
        custom_quote|no_public_price) price_json="" ;;
        *) price_json=',"price":"25000"' ;;
      esac
      req POST "/vendors/$2/services/$svc_id/offerings" \
        "{\"name\":\"Standard\",\"pricingModel\":\"$model\"$price_json,\"active\":true}" "$1" >/dev/null
      [ "$(jq -r '.id // empty' /tmp/body)" != "" ] && return 0
    done
  done
  return 1
}

go_live() { # go_live <vendorToken> <businessId> <adminToken> <officerId> <officerToken>
  seed_catalog "$1" "$2" || return 1
  req POST "/vendors/$2/first-review" "" "$1" >/dev/null
  req POST "/vendors/$2/submit-verification" "" "$1" >/dev/null

  req GET "/verification/requests?applicantType=vendor&limit=100" "" "$3" >/dev/null
  vreq=$(jq -r --arg id "$2" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
  [ -z "$vreq" ] && return 1

  req PUT "/verification/requests/$vreq/allocate" "{\"officerUserId\":\"$4\"}" "$3" >/dev/null
  req PUT "/verification/requests/$vreq/start" "" "$5" >/dev/null
  req PUT "/verification/requests/$vreq/findings" "$FINDINGS_JSON" "$5" >/dev/null
  req PUT "/verification/requests/$vreq/decide" '{"status":"approved"}' "$5" >/dev/null
  return 0
}

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

# An approval has to rest on a visit somebody actually made and wrote up.
# Without this the whole verification step is a checkbox.
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "and an approval before anybody has been anywhere is refused too" "$c" 400
c=$(req PUT "/verification/requests/$REQ/findings" '{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}' "$OFFICER")
check "officer writes up the visit" "$c" 200
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "officer approves on the strength of it" "$c" 200

c=$(req GET /agents/agency "" "$AGENT")
body_has '"isApproved":true' "the approval activated the agency"
c=$(req POST /agents/profiles "{\"displayName\":\"Client\",\"contactEmail\":\"client-$STAMP@t.com\",\"contactPhone\":\"$(phone 002)\",\"gender\":\"female\",\"dateOfBirth\":\"1997-01-01\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "and the agency can now build profiles" "$c" 201
MANAGED=$(field /tmp/body id)

echo
echo "== 5. Identity documents, and the duplicate they catch =="
c=$(req POST "/users/profiles/$MANAGED/identity" "{\"idType\":\"aadhaar\",\"idNumber\":\"$BAD_AADHAAR\"}" "$AGENT")
check "an Aadhaar number that fails its checksum is refused" "$c" 400
c=$(req POST "/users/profiles/$MANAGED/identity" "{\"idType\":\"passport\",\"idNumber\":\"$PASSPORT_A\"}" "$AGENT")
check "agent records the client's identity document" "$c" 201
body_has "\"last4\":\"$(echo "$PASSPORT_A" | tail -c 5)\"" "only the last four characters are kept"

c=$(req POST /agents/profiles "{\"displayName\":\"Partner\",\"contactPhone\":\"$(phone 003)\",\"gender\":\"male\",\"dateOfBirth\":\"1995-05-05\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
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
# MANAGED was confirmed by the officer in section 5. PARTNER has a document on
# file that nobody has confirmed — which is precisely the state the gate
# refuses, so the officer confirms it here rather than the fixture faking it.
c=$(req PUT "/verification/identity/$PARTNER/verify" "" "$OFFICER")
check "the officer confirms the counterpart's document too" "$c" 200
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

# A listing is now walked to live rather than flipped. Nothing is verified
# until the vendor has filled in a catalog, looked the whole thing over and
# submitted it — an officer cannot approve something nobody has asked about.
c=$(req GET "/vendors/$LISTING/completion" "" "$VENDOR")
check "the completion check is served" "$c" 200
body_has '"canSubmit":false' "and a listing with no catalog cannot be submitted"
body_has 'Catalog services' "naming what is missing"

c=$(req POST "/vendors/$LISTING/submit-verification" "" "$VENDOR")
check "submitting an incomplete listing is refused" "$c" 400

seed_catalog "$VENDOR" "$LISTING"
c=$(req GET "/vendors/$LISTING/completion" "" "$VENDOR")
body_has '"canSubmit":true' "with a priced service it can be submitted"

c=$(req POST "/vendors/$LISTING/submit-verification" "" "$VENDOR")
check "but not before somebody has looked it over" "$c" 400
c=$(req POST "/vendors/$LISTING/first-review" "" "$VENDOR")
check "the vendor opens the first review" "$c" 200
c=$(req POST "/vendors/$LISTING/submit-verification" "" "$VENDOR")
check "and submits it" "$c" 200
body_has '"status":"pending_verification"' "which locks the listing"

# The lock is enforced by the API, not by hiding a button.
c=$(req PUT "/vendors/$LISTING" '{"description":"Sneaking an edit in."}' "$VENDOR")
check "the details cannot be edited while it is being verified" "$c" 403

c=$(req GET /verification/me "" "$VENDOR")
VREQ=$(field /tmp/body id)
c=$(req PUT "/admin/vendors/$LISTING/approve" "" "$ADMIN")
check "there is no administrative shortcut past the visit" "$c" 404
# Omitting the officer lets the platform pick the lightest-loaded one. Earlier
# runs leave their own officers on duty, so the assertion is that it chose *an*
# active officer, not which one.
c=$(req PUT "/verification/requests/$VREQ/allocate" '{}' "$ADMIN")
check "admin allocates the visit without naming an officer" "$c" 200
body_has '"status":"assigned"' "the platform picked the lightest-loaded officer"

# Re-allocated to this run's officer, whose token the suite holds.
c=$(req PUT "/verification/requests/$VREQ/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "an administrator can override the choice" "$c" 200
c=$(req GET "/verification/requests/$VREQ" "" "$OFFICER")
check "the officer opens the request" "$c" 200
body_has '"subject"' "and gets the business record they are going to verify"
req PUT "/verification/requests/$VREQ/findings" '{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}' "$OFFICER" >/dev/null
c=$(req PUT "/verification/requests/$VREQ/decide" '{"status":"approved"}' "$OFFICER")
check "officer approves the listing after the visit" "$c" 200
c=$(req GET "/vendors/$LISTING" "")
body_has '"status":"live"' "and the listing goes live"

c=$(req GET "/vendors/$LISTING" "")
body_has '"isApproved":true' "the officer's decision is what activated it"

# The bride needs a fixed match of her own before services open to her.
PREFS='{"religion":"hindu","education":"masters","lifestyle":["vegetarian","non-smoker"]}'
req PUT /users/me/profile "{\"displayName\":\"Bride\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Groom\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$GROOM" >/dev/null
c=$(req GET /users/me "" "$GROOM")
GROOM_PROFILE=$(field /tmp/body id)
c=$(req GET /users/me "" "$BRIDE")
BRIDE_PROFILE=$(field /tmp/body id)

# The marketplace is open before any match is fixed, and that is deliberate.
# The platform earns on this booking whether or not the couple met here, and a
# match fixed at home is still a wedding that needs a caterer.
c=$(req GET /matches/status "" "$BRIDE")
body_has '"servicesUnlocked":true' "services report as open with no match fixed"
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"amount\":100000,\"eventDate\":\"2027-02-14\"}" "$BRIDE")
check "and the bride books a vendor with no match fixed at all" "$c" 201
EARLY_BOOKING=$(field /tmp/body id)
c=$(req PUT "/bookings/$EARLY_BOOKING/cancel" '{"reason":"Only here to prove the door is open."}' "$BRIDE")
check "she withdraws it again, leaving the rest of the suite as it was" "$c" 200

verify_identity "$BRIDE_PROFILE" "$BRIDE" >/dev/null
verify_identity "$GROOM_PROFILE" "$GROOM" >/dev/null
c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\"}" "$BRIDE")
check "bride sends the groom an interest" "$c" 201
BG=$(field /tmp/body id)
c=$(req PUT "/matches/$BG/accept" "" "$GROOM")
check "groom accepts" "$c" 200
c=$(req PUT "/matches/$BG/match-fixed" "" "$BRIDE")
check "bride confirms" "$c" 200
c=$(req PUT "/matches/$BG/match-fixed" "" "$GROOM")
check "groom confirms and their match is fixed" "$c" 200

# Availability runs on a rolling six-month window, so the dates the suite
# uses are computed from today rather than written down.
# Epoch arithmetic rather than `date -d '+30 days'`, which busybox does not
# understand — the suite runs inside an Alpine container.
days_from_now() { date -d "@$(( $(date +%s) + $1 * 86400 ))" +%Y-%m-%d; }
SLOT_DATE=$(days_from_now 30)
# Comfortably inside six months and comfortably outside three, so this asserts
# the widening rather than merely surviving it.
FIFTH_MONTH=$(days_from_now 150)
FAR_DATE=$(days_from_now 260)
PAST_DATE=$(days_from_now -1)

c=$(req GET /vendors/availability/window "")
check "the rolling window is published" "$c" 200

c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$FIFTH_MONTH\",\"startTime\":\"12:00\",\"endTime\":\"16:00\"}" "$VENDOR")
check "a date in the fifth month is publishable, which three months refused" "$c" 201
FIFTH_SLOT=$(field /tmp/body id)
req DELETE "/vendors/$LISTING/availability/slots/$FIFTH_SLOT" "" "$VENDOR" >/dev/null

c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$FAR_DATE\",\"startTime\":\"12:00\",\"endTime\":\"16:00\"}" "$VENDOR")
check "a slot beyond the six-month window is still refused" "$c" 400
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$PAST_DATE\",\"startTime\":\"12:00\",\"endTime\":\"16:00\"}" "$VENDOR")
check "a slot in the past is refused" "$c" 400
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"16:00\",\"endTime\":\"12:00\"}" "$VENDOR")
check "an end time before the start is refused" "$c" 400

c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"12:00\",\"endTime\":\"16:00\",\"note\":\"Afternoon\"}" "$VENDOR")
check "vendor publishes an afternoon slot" "$c" 201
SLOT_A=$(field /tmp/body id)
# Overlap is no longer refused: capacity governs how much a vendor can do at
# once, not the clock. A caterer whose lunch and evening share an hour of setup
# is normal. Publishing the *same* window twice is still refused, because that
# is a mis-click that splits one capacity across two rows.
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"14:00\",\"endTime\":\"18:00\"}" "$VENDOR")
check "an overlapping slot is allowed — capacity decides, not the clock" "$c" 201
SLOT_OVERLAP=$(field /tmp/body id)
c=$(req DELETE "/vendors/$LISTING/availability/slots/$SLOT_OVERLAP" "" "$VENDOR")
check "and it can be withdrawn again while nobody has asked for it" "$c" 200
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"12:00\",\"endTime\":\"16:00\"}" "$VENDOR")
check "publishing the identical window twice is refused" "$c" 400
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"18:00\",\"endTime\":\"22:00\",\"note\":\"Evening\"}" "$VENDOR")
check "a back-to-back slot is fine" "$c" 201
SLOT_B=$(field /tmp/body id)

c=$(req POST "/vendors/$LISTING/availability/slots/$SLOT_B/block" '{"reason":"our own function"}' "$VENDOR")
check "vendor blocks the evening slot" "$c" 200
c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
check "the buyer view lists bookable slots" "$c" 200
grep -q "$SLOT_B" /tmp/body && assert "a blocked slot is offered to buyers" 0 || assert "a blocked slot is not offered to buyers" 1
grep -q "$SLOT_A" /tmp/body && assert "the open slot is offered" 1 || assert "the open slot is missing" 0
c=$(req POST "/vendors/$LISTING/availability/slots/$SLOT_B/unblock" "" "$VENDOR")
check "vendor opens it again" "$c" 200

c=$(req GET "/vendors/$LISTING/availability/summary" "" "$VENDOR")
check "the availability summary counts the window" "$c" 200
body_has '"openSlots":2' "both slots read as open"

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT_A\",\"eventDate\":\"$SLOT_DATE\",\"requirements\":\"Catering for 300 guests, vegetarian and non-vegetarian.\",\"expectedBudget\":50000}" "$BRIDE")
check "bride requests the afternoon slot" "$c" 201
BOOKING=$(field /tmp/body id)
body_has '"status":"requested"' "a request starts unpriced"

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT_A\",\"eventDate\":\"$SLOT_DATE\",\"requirements\":\"Same thing again by mistake.\"}" "$BRIDE")
check "a second request for the same slot is refused" "$c" 409
body_has 'DUPLICATE_BOOKING_REQUEST' "the refusal names the request they already have"

# A request is a question, not a booking. It must not take the window off sale
# — that is what stopped a caterer's five-team afternoon being bookable because
# one family had enquired about it.
c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
grep -q "$SLOT_A" /tmp/body && assert "a requested slot stays open — a request does not consume capacity" 1 || assert "a requested slot was wrongly taken off sale" 0
body_has '"pending":1' "the request is counted separately from bookings"
body_has '"confirmed":0' "and consumes no capacity"

c=$(req DELETE "/vendors/$LISTING/availability/slots/$SLOT_A" "" "$VENDOR")
check "a slot with a live request cannot be deleted" "$c" 400

c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":20000}]}' "$VENDOR")
check "line items that do not add up are refused" "$c" 400
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":30000}]}' "$BRIDE")
check "the buyer cannot quote to themselves" "$c" 403
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":90000,"lines":[{"description":"Hall","amount":60000},{"description":"Catering","amount":30000}]}' "$VENDOR")
check "vendor quotes for the job" "$c" 201
QUOTE=$(field /tmp/body id)

c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":85000,"terms":"Cancellation inside 30 days forfeits the advance. Overtime billed hourly.","validUntil":"2099-01-01"}' "$VENDOR")
check "vendor re-quotes, on stated terms" "$c" 201
QUOTE2=$(field /tmp/body id)
body_has 'Cancellation inside 30 days' "the conditions travel with the price"
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":85000,"validUntil":"2020-01-01"}' "$VENDOR")
check "a validity date already past is refused" "$c" 400
# And refusing it must not have taken the live offer down. The supersede used to
# run before this check, so a mistyped year left the buyer with nothing to
# accept and no new offer in its place.
c=$(req GET "/bookings/$BOOKING/quotations" "" "$BRIDE")
assert "and the refusal left the live offer standing" "$(jq -e --arg q "$QUOTE2" 'map(select(.id == $q and .status == "sent")) | length > 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req PUT "/bookings/quotations/$QUOTE/accept" '{}' "$BRIDE")
check "the superseded quotation can no longer be accepted" "$c" 400
c=$(req PUT "/bookings/quotations/$QUOTE2/accept" '{}' "$VENDOR")
check "the vendor cannot accept on the buyer's behalf" "$c" 403
c=$(req PUT "/bookings/quotations/$QUOTE2/accept" '{}' "$BRIDE")
check "bride accepts the live quotation" "$c" 200
body_has '"status":"quotation_accepted"' "acceptance settles the price"
body_has '"amount":"85000.00"' "and the accepted price is what the booking now carries"
# Which offer this booking is, so a later re-quote cannot rewrite the deal that
# was struck — the quotation it points at is never edited in place.
body_has "\"acceptedQuotationId\":\"$QUOTE2\"" "the booking records which offer it was struck on"

echo
echo "== 9. Money and work alternate =="
c=$(req GET "/bookings/$BOOKING/milestones" "" "$BRIDE")
check "the instalments are listed" "$c" 200
body_has '"amount":"25500.00"' "the advance is 30% of the accepted price"
body_has '"amount":"34000.00"' "and the balance is the remainder, not a third percentage"

# Neither side can get ahead of the other, and every gate is enforced by the
# API rather than by hiding a button.
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "the advance waits for the provider to accept the job" "$c" 400
c=$(req PUT "/bookings/$BOOKING/confirm" "" "$BRIDE")
check "the buyer cannot accept the job on the vendor's behalf" "$c" 403
c=$(req PUT "/bookings/$BOOKING/confirm" "" "$VENDOR")
check "vendor accepts the job" "$c" 200

# Accepting is the moment the window is actually spent — not the request, not
# the quotation, and not the advance.
c=$(req GET "/vendors/$LISTING/availability/slots?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"confirmed":1' "accepting the job is what consumes capacity"
body_has '"pending":0' "and clears the request it came from"
c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
grep -q "$SLOT_A" /tmp/body && assert "a full slot is still offered" 0 || assert "a slot at capacity leaves the buyer list" 1

c=$(req PUT "/bookings/$BOOKING/start" "" "$VENDOR")
check "vendor cannot start before the advance is held" "$c" 400
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"final"}' "$BRIDE")
check "the balance cannot jump the queue" "$c" 400

# The booking's own thread. Shut until the advance is held, because before that
# there is a quotation to argue about and screens that keep a record of it.
c=$(req GET "/bookings/$BOOKING/chat" "" "$BRIDE")
check "the booking reports where its conversation stands" "$c" 200
body_has '"canSend":false' "and it is shut before the advance is paid"
body_has 'Chat opens once the advance is paid' "saying exactly why"
c=$(req POST "/bookings/$BOOKING/messages" '{"body":"Can we talk before I pay?"}' "$BRIDE")
check "and posting into it is refused, not merely hidden" "$c" 400

c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "bride pays the advance" "$c" 200
body_has '"status":"confirmed"' "the advance is what confirms the booking"

c=$(req GET "/bookings/$BOOKING/chat" "" "$VENDOR")
body_has '"canSend":true' "paying the advance is what opens the thread"
c=$(req POST "/bookings/$BOOKING/messages" '{"body":"Advance received. Reach me on 9876543210 to confirm the setup time."}' "$VENDOR")
check "the vendor writes in it" "$c" 201
body_has '"redactedCount":1' "and a phone number in it is stripped like anywhere else"
c=$(req POST "/bookings/$BOOKING/messages" '{"body":"Noted, thank you."}' "$BRIDE")
check "the buyer replies" "$c" 201
c=$(req GET "/bookings/$BOOKING/messages" "" "$BRIDE")
check "the thread reads back" "$c" 200
body_has 'Advance received' "carrying both sides"

# A booking is between two people. Nobody else is in the room.
c=$(req POST "/bookings/$BOOKING/messages" '{"body":"Let me in."}' "$GROOM")
check "a third account cannot post into somebody else's booking" "$c" 403
c=$(req GET "/bookings/$BOOKING/messages" "" "$GROOM")
check "nor read it" "$c" 403

# And it stays out of the Chat screen, which has no way to lock it.
c=$(req GET /chat/conversations "" "$VENDOR")
check "the vendor's conversation list is served" "$c" 200
grep -q 'Advance received' /tmp/body && assert "the booking thread leaked into the Chat list" 0 || assert "the booking thread stays on the booking" 1
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "the same instalment cannot be paid twice" "$c" 400

c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
grep -q "$SLOT_A" /tmp/body && assert "a booked slot is still offered" 0 || assert "the booked slot leaves the buyer list" 1

c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"second"}' "$BRIDE")
check "the second instalment waits for work to start" "$c" 400
c=$(req PUT "/bookings/$BOOKING/start" "" "$VENDOR")
check "vendor starts work" "$c" 200
c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "vendor cannot mark it done before the second instalment" "$c" 400
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"second"}' "$BRIDE")
check "bride pays the second instalment" "$c" 200

echo "== 10. A case freezes the money until somebody decides =="
c=$(req POST /verification/cases "{\"subjectType\":\"booking\",\"subjectId\":\"$BOOKING\",\"title\":\"Venue not as described\",\"description\":\"The hall shown at the visit is not the hall we were given.\"}" "$BRIDE")
check "bride raises a case against the booking" "$c" 201
CASE=$(field /tmp/body id)

c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "the provider cannot close the job while the case is open" "$c" 400
c=$(req PUT "/bookings/$BOOKING/cancel" '{"reason":"forget it"}' "$BRIDE")
check "nor can the buyer refund it out from under the case" "$c" 400

c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"release"}' "$BRIDE")
check "the person who raised it cannot settle it" "$c" 403

# Triage: somebody reads it and decides what kind of thing it is. Priority is
# set here rather than taken from the complainant, because everybody's own
# problem is urgent.
c=$(req PUT "/verification/cases/$CASE/triage" '{"priority":"high","category":"venue"}' "$ADMIN")
check "an administrator triages it" "$c" 200
body_has '"status":"triaged"' "which is a state of its own, not still 'open'"
body_has '"priority":"high"' "carrying the priority the desk decided"

c=$(req PUT "/verification/cases/$CASE/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates the case" "$c" 200
c=$(req PUT "/verification/cases/$CASE/findings" '{"findings":"Visited the venue. The hall matches the listing photographs."}' "$OFFICER")
check "officer records what they found" "$c" 200
c=$(req PUT "/verification/cases/$CASE/findings" '{"findings":"Trying to mark it decided on the way past.","status":"resolved"}' "$OFFICER")
check "and cannot mark it decided while writing them up" "$c" 400

c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"partial"}' "$OFFICER")
check "a partial settlement needs the amount" "$c" 400

# The officer recommends; the administrator decides. An officer who both finds
# the facts and releases the escrow is one person deciding a payment dispute
# alone, with nobody to catch it when they get it wrong.
c=$(req PUT "/verification/cases/$CASE/settle" '{"outcome":"release","notes":"Provider delivered as described."}' "$OFFICER")
check "the officer proposes releasing the money" "$c" 200
body_has '"status":"resolution_submitted"' "which is a proposal, not a decision"
c=$(req GET "/bookings/$BOOKING/milestones" "" "$BRIDE")
grep -q '"status":"released"' /tmp/body && assert "the proposal moved the money on its own" 0 || assert "and nothing has moved yet" 1

c=$(req PUT "/verification/cases/$CASE/review" '{"decision":"reassign"}' "$ADMIN")
check "sending it back without saying why is refused" "$c" 400

c=$(req PUT "/verification/cases/$CASE/review" '{"decision":"approve"}' "$ADMIN")
check "the administrator approves it" "$c" 200
body_has '"status":"resolved"' "and that is what resolves the case"

c=$(req GET "/bookings/$BOOKING/milestones" "" "$BRIDE")
body_has '"status":"released"' "the settlement is what moved the money"

# Resolved is not closed. The platform has finished; the complainant has not
# necessarily agreed, and support marking its own homework is what one state
# for both allowed.
c=$(req GET "/verification/cases/$CASE" "" "$BRIDE")
body_has '"status":"resolved"' "the case reads as resolved"
grep -q '"closedAt":null' /tmp/body && assert "and is not closed yet" 1 || assert "resolving it closed it too" 0
c=$(req PUT "/verification/cases/$CASE/close" "" "$GROOM")
check "somebody uninvolved cannot close it" "$c" 403
c=$(req PUT "/verification/cases/$CASE/close" "" "$BRIDE")
check "the person who raised it closes it" "$c" 200
body_has '"status":"closed"' "which is the second fact, with its own date"

# With the case settled the job can finish, and the balance closes it.
c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "vendor marks the work delivered" "$c" 200
body_has 'completed_pending_final_payment' "delivery makes the balance payable, it does not close the booking"
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"final"}' "$BRIDE")
check "bride pays the balance" "$c" 200
body_has '"status":"completed"' "paying the balance is what completes the booking"

# Finished, so the thread stops taking messages — and stays readable, because
# what was agreed in it is exactly what a later argument turns on.
c=$(req GET "/bookings/$BOOKING/chat" "" "$VENDOR")
body_has '"canSend":false' "a finished job stops taking messages"
body_has '"open":true' "but the thread is still there"
body_has 'raise a dispute' "and points at where a complaint belongs instead"
c=$(req POST "/bookings/$BOOKING/messages" '{"body":"One more thing."}' "$VENDOR")
check "posting into a finished job is refused" "$c" 403
c=$(req GET "/bookings/$BOOKING/messages" "" "$BRIDE")
check "and the record is still readable" "$c" 200
body_has 'Advance received' "with everything that was said in it"

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
c=$(req POST /agents/profiles "{\"displayName\":\"Paused\",\"contactPhone\":\"$(phone 004)\",\"gender\":\"female\",\"dateOfBirth\":\"1998-08-08\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
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
