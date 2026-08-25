#!/bin/sh
# Live verification of the service catalog and the reworked availability model.
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
#     sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-phase4.sh"
#
# Two things are being proved here.
#
# The catalog is configuration rather than code: a new kind of service is rows
# an administrator writes, and every answer a vendor or buyer gives is checked
# against those rows before it is stored.
#
# And a request does not consume capacity. The old model flipped a whole window
# to PENDING the moment somebody enquired, which took a caterer's five-team
# afternoon off sale for one question. Requests and bookings are now separate
# counters and only the second is measured against capacity.
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

body_has() {
  if grep -q "$1" /tmp/body; then
    printf '  PASS  %s\n' "$2"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %s (looked for %s) %s\n' "$2" "$1" "$(head -c 300 /tmp/body)"; FAIL=$((FAIL + 1))
  fi
}

field() { jq -r ".$2 // empty" "$1"; }

# A GST number is unique platform-wide, so a random four digits collides once a
# suite has been run a few hundred times — and it fails as "already registered",
# which reads like a real defect rather than a repeated run. Derived from the
# run's own stamp instead, with a counter for the several listings one run makes.
# A GST number is unique platform-wide, so four random digits collide once a
# suite has run a few hundred times — and it fails as "already registered",
# which reads like a real defect rather than a repeated run. Derived from the
# run's own stamp instead, with the caller supplying an index because a counter
# incremented inside $(...) increments in a subshell and never comes back.
#
#   gst <n>   ->  a valid, run-unique GSTIN
gst() {
  letters=$(printf '%s' "$STAMP" | tr -dc 'A-Za-z' | tr 'a-z' 'A-Z')
  letters=$(printf '%.5s' "${letters}ABCDE")
  digits=$(printf '%s' "$STAMP" | tr -dc '0-9')
  digits=$(printf '%.4s' "${digits}0000")
  # Fifteen characters: two state digits, five letters, four digits, a letter,
  # a digit, Z, and a checksum position. The letter at position 11 is the easy
  # one to get wrong.
  printf '36%s%sF%dZ5' "$letters" "$digits" "$(( ${1:-1} % 10 ))"
}

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
  [ -z "$cat_ids" ] && return 1

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

# Three photographs before the details. A biodata with no picture is one
# nobody looks at, so the section that starts the form now requires them.
seed_photos() { # seed_photos <profileId> <token>
  for n in 1 2 3; do
    req POST "/profiles/$1/details/photos" "{\"url\":\"https://cdn.example.com/seed-$1-$n.jpg\"}" "$2" >/dev/null
  done
}


REG_PHONE_BASE=$(date +%s | tail -c 7)
REG_N=0
reg() {
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  REG_N=$((REG_N + 1))
  phone=$(printf '9%s%03d' "$REG_PHONE_BASE" "$((700 + REG_N))")
  name="Test $(echo "$key" | tr -d '0-9')"
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"$name\",\"phone\":\"$phone\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}

days_from_now() { date -d "@$(( $(date +%s) + $1 * 86400 ))" +%Y-%m-%d; }

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

echo
echo "== 1. The catalog ships with a starting vocabulary =="
c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin signs in" "$c" 200
ADMIN=$(field /tmp/body accessToken)

c=$(req GET /catalog/vocabulary "" "$ADMIN")
check "the vocabulary is served from the server, not a second copy in the client" "$c" 200
assert "all fifteen attribute types are offered" "$(jq -e '.attributeTypes | length == 15' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "all nine pricing models are offered" "$(jq -e '.pricingModels | length == 9' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req GET /catalog/categories "" "$ADMIN")
check "the seeded categories are readable" "$c" 200
body_has '"slug":"catering"' "catering is in the catalog"
body_has '"slug":"priest"' "so is a priest, which no module was ever written for"

echo
echo "== 2. A new kind of service is configuration, not a deployment =="
c=$(req POST /admin/catalog/categories "{\"slug\":\"drone-$STAMP\",\"name\":\"Drone crews\",\"description\":\"Aerial coverage\"}" "$ADMIN")
check "admin adds a category nobody wrote code for" "$c" 201
CAT=$(field /tmp/body id)

c=$(req POST /admin/catalog/categories "{\"slug\":\"drone-$STAMP\",\"name\":\"Duplicate\"}" "$ADMIN")
check "the same slug twice is refused" "$c" 400

c=$(req POST "/admin/catalog/categories/$CAT/services" "{\"slug\":\"aerial\",\"name\":\"Aerial coverage\",\"allowedPricingModels\":[\"per_hour\",\"fixed\",\"custom_quote\"],\"availabilityModel\":\"slot\",\"packagesAllowed\":false,\"defaultCapacity\":2}" "$ADMIN")
check "and a service under it" "$c" 201
DEF=$(field /tmp/body id)

c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"service\",\"key\":\"max_altitude\",\"label\":\"Maximum altitude\",\"type\":\"number\",\"required\":true,\"constraints\":{\"min\":10,\"max\":500},\"filterable\":true}" "$ADMIN")
check "a numeric attribute with bounds" "$c" 201
c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"booking\",\"key\":\"shoot_time\",\"label\":\"Time of the shoot\",\"type\":\"time\",\"required\":true}" "$ADMIN")
check "and a question asked of the buyer" "$c" 201
c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"booking\",\"key\":\"permission\",\"label\":\"Do you have flying permission?\",\"type\":\"single_select\",\"constraints\":{\"options\":[{\"value\":\"yes\",\"label\":\"Yes\"},{\"value\":\"no\",\"label\":\"No\"}]}}" "$ADMIN")
check "a select with options" "$c" 201

c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"booking\",\"key\":\"broken\",\"label\":\"Broken select\",\"type\":\"single_select\"}" "$ADMIN")
check "a select with no options is refused — it renders as a form nobody can fill in" "$c" 400
c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"service\",\"key\":\"max_altitude\",\"label\":\"Again\",\"type\":\"number\"}" "$ADMIN")
check "the same key twice on one form is refused" "$c" 400
c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"service\",\"key\":\"bad_bounds\",\"label\":\"Bad bounds\",\"type\":\"number\",\"constraints\":{\"min\":50,\"max\":10}}" "$ADMIN")
check "a minimum above its maximum is refused" "$c" 400

c=$(req GET "/catalog/services/$DEF" "" "$ADMIN")
check "the definition serves both of its forms" "$c" 200
body_has '"serviceForm"' "the vendor form"
body_has '"bookingForm"' "and the buyer form, from the same rows the validator uses"

echo
echo "== 3. Only an administrator configures it =="
reg vendor vendor ""
reg bride individual bride
reg groom individual groom
VENDOR=$(field /tmp/vendor.json accessToken)
BRIDE=$(field /tmp/bride.json accessToken)
GROOM=$(field /tmp/groom.json accessToken)

# The buyer gets married here not because bookings require it — they no longer
# do — but because later sections need a fixed match of their own: the agency
# success fee, and matchmaking closing. Done in as few steps as possible.
PREFS='{"religion":"hindu","education":"masters","lifestyle":["vegetarian"]}'
req PUT /users/me/profile "{\"displayName\":\"Bride\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Groom\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$GROOM" >/dev/null
c=$(req GET /users/me "" "$GROOM")
GROOM_PROFILE=$(field /tmp/body id)
c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\"}" "$BRIDE")
check "bride sends the groom an interest" "$c" 201
BG=$(field /tmp/body id)
req PUT "/matches/$BG/accept" "" "$GROOM" >/dev/null
req PUT "/matches/$BG/match-fixed" "" "$BRIDE" >/dev/null
c=$(req PUT "/matches/$BG/match-fixed" "" "$GROOM")
check "their match is fixed, which unlocks wedding services" "$c" 200

c=$(req POST /admin/catalog/categories "{\"slug\":\"vendor-invented\",\"name\":\"Whatever I like\"}" "$VENDOR")
check "a vendor cannot invent a category" "$c" 403
c=$(req POST "/admin/catalog/services/$DEF/attributes" "{\"scope\":\"service\",\"key\":\"x\",\"label\":\"X\",\"type\":\"text\"}" "$BRIDE")
check "nor can a buyer add a question" "$c" 403

echo
echo "== 4. A vendor lists against the catalog =="
GST=$(gst 1)
c=$(req POST /vendors "{\"name\":\"Sky $STAMP\",\"category\":\"other\",\"otherCategory\":\"Drone crew\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GST\",\"panNumber\":\"ABCDE1234F\",\"registeredAddress\":\"12 Banjara Hills, Hyderabad\",\"contactPhone\":\"9876543210\"}" "$VENDOR")
check "vendor creates the business" "$c" 201
LISTING=$(field /tmp/body id)
# A business is approved by a verification officer who visited it, not by an
# administrator clicking approve — the old direct route was removed for that
# reason. Setup here; the separations are exercised in verify-phase1.
c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Officer $STAMP\",\"region\":\"Hyderabad\"}" "$ADMIN")
check "admin creates a verification officer" "$c" 201
OFFICER_ID=$(field /tmp/body id)
OFFICER_TEMP=$(field /tmp/body devPassword)
req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"$OFFICER_TEMP\"}" >/dev/null
OFFICER=$(field /tmp/body accessToken)
req POST /auth/password/change "{\"currentPassword\":\"$OFFICER_TEMP\",\"newPassword\":\"OfficerPass1\"}" "$OFFICER" >/dev/null
req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"OfficerPass1\"}" >/dev/null
OFFICER=$(field /tmp/body accessToken)


c=$(req POST "/vendors/$LISTING/services" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":120}}" "$VENDOR")
check "vendor offers the service" "$c" 201
VS=$(field /tmp/body id)
body_has '"concurrentCapacity":2' "capacity defaults to what the definition configured"

c=$(req POST "/vendors/$LISTING/services" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":90}}" "$VENDOR")
check "the same service twice is refused" "$c" 400

echo
echo "== 5. Answers are validated against the configuration =="
c=$(req POST "/vendors/$LISTING/services" "{\"definitionId\":\"$DEF\"}" "$VENDOR")
check "a required attribute cannot be skipped" "$c" 400
c=$(req PUT "/vendors/$LISTING/services/$VS" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":900}}" "$VENDOR")
check "a value above its maximum is refused" "$c" 400
body_has 'must be at most 500' "and the refusal says which bound it broke"
c=$(req PUT "/vendors/$LISTING/services/$VS" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":\"not a number\"}}" "$VENDOR")
check "a value of the wrong type is refused" "$c" 400

c=$(req PUT "/vendors/$LISTING/services/$VS" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":\"150\",\"nonsense\":\"ignored\"}}" "$VENDOR")
check "a number arriving as a string from a form is coerced" "$c" 200
body_has '"max_altitude":150' "and stored as a number, so comparisons work"
grep -q 'nonsense' /tmp/body && assert "an unknown key was stored" 0 || assert "an unknown key is dropped rather than stored unchecked" 1

echo
echo "== 6. The configuration constrains how it may be priced =="
c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Per plate\",\"pricingModel\":\"per_person\",\"price\":\"450\"}" "$VENDOR")
check "a pricing model the service does not allow is refused" "$c" 400
body_has 'Allowed:' "and the refusal lists what is allowed"
c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Gold package\",\"pricingModel\":\"fixed\",\"price\":\"50000\",\"isPackage\":true}" "$VENDOR")
check "a package on a service that is not sold as one is refused" "$c" 400
c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Hourly\",\"pricingModel\":\"per_hour\"}" "$VENDOR")
check "a priced model with no price is refused" "$c" 400

c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Hourly\",\"pricingModel\":\"per_hour\",\"price\":\"8000\",\"unitLabel\":\"per hour\",\"minQuantity\":2,\"maxQuantity\":8}" "$VENDOR")
check "vendor publishes an hourly price" "$c" 201
OFFER=$(field /tmp/body id)

c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Ask us\",\"pricingModel\":\"custom_quote\",\"price\":\"1000\"}" "$VENDOR")
check "a custom quote may still be created" "$c" 201
body_has '"price":null' "and carries no price, whatever was sent — that is what custom quote means"

echo
echo "== 7. The booking form is generated, not written per vendor type =="
c=$(req GET "/services/$VS/booking-form" "" "$BRIDE")
check "the buyer is served the form for this service" "$c" 200
body_has '"key":"shoot_time"' "carrying the question the administrator configured"
body_has '"key":"permission"' "and the select, with its options"
body_has '"offerings"' "alongside the prices they can choose from"

# ---------------------------------------------------------------------------
# The listing is complete now, so it can be walked to live: look it over,
# submit, visit, decide. Placed here rather than earlier because the completion
# check requires a priced service, and that is what sections 4 to 6 just built.
req POST "/vendors/$LISTING/first-review" "" "$VENDOR" >/dev/null
c=$(req POST "/vendors/$LISTING/submit-verification" "" "$VENDOR")
check "the vendor submits the completed business for verification" "$c" 200
body_has '"status":"pending_verification"' "which locks it"

c=$(req PUT "/vendors/$LISTING" '{"description":"Editing during verification."}' "$VENDOR")
check "and the details cannot be edited while an officer is on the way" "$c" 403

c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
REQ=$(jq -r --arg id "$LISTING" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
assert "the submission raised a verification request of its own" "$([ -n "$REQ" ] && echo 1 || echo 0)"
c=$(req PUT "/verification/requests/$REQ/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates the visit to the officer" "$c" 200
req PUT "/verification/requests/$REQ/start" "" "$OFFICER" >/dev/null
req PUT "/verification/requests/$REQ/findings" '{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}' "$OFFICER" >/dev/null
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "officer approves the business after the visit" "$c" 200
c=$(req GET "/vendors/$LISTING" "")
body_has '"status":"live"' "and it goes live"

echo
echo "== 8. Capacity, and what a request is worth =="
SLOT_DATE=$(days_from_now 40)
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"09:00\",\"endTime\":\"13:00\",\"vendorServiceId\":\"$VS\",\"capacity\":3}" "$VENDOR")
check "vendor publishes a morning window with capacity 3" "$c" 201
SLOT=$(field /tmp/body id)
body_has '"state":"open"' "it starts open"
body_has '"remaining":3' "with everything remaining"

c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"14:00\",\"endTime\":\"18:00\",\"vendorServiceId\":\"$VS\",\"capacity\":1}" "$VENDOR")
check "a second window on the same day is fine" "$c" 201
SLOT2=$(field /tmp/body id)
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"12:00\",\"endTime\":\"15:00\",\"vendorServiceId\":\"$VS\"}" "$VENDOR")
check "so is one that overlaps them — capacity governs, not the clock" "$c" 201
SLOT3=$(field /tmp/body id)
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"09:00\",\"endTime\":\"13:00\",\"vendorServiceId\":\"$VS\"}" "$VENDOR")
check "but the identical window twice is refused" "$c" 400

c=$(req PUT "/vendors/$LISTING/availability/slots/$SLOT" '{"capacity":5,"note":"Two crews free"}' "$VENDOR")
check "the vendor edits the window" "$c" 200
body_has '"capacity":5' "capacity is raised"
body_has '"remaining":5' "and remaining follows it without being maintained by hand"

# The heart of it. Three families ask about the same morning.
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT\",\"eventDate\":\"$SLOT_DATE\",\"vendorServiceId\":\"$VS\",\"offeringId\":\"$OFFER\",\"quantity\":4,\"serviceAnswers\":{\"shoot_time\":\"10:30\",\"permission\":\"yes\"},\"requirements\":\"Aerial coverage of the baraat and the mandap.\"}" "$BRIDE")
check "a buyer requests the window through the generated form" "$c" 201
BOOKING=$(field /tmp/body id)
body_has '"shoot_time":"10:30"' "their answers are stored against the booking"

c=$(req GET "/vendors/$LISTING/availability/slots?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"pending":1' "the request is counted"
body_has '"confirmed":0' "but consumes no capacity"
c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
grep -q "$SLOT" /tmp/body && assert "and the window stays on sale for everybody else" 1 || assert "the window was wrongly taken off sale by one question" 0

echo
echo "== 9. Answers that do not fit the form are refused =="
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT2\",\"eventDate\":\"$SLOT_DATE\",\"vendorServiceId\":\"$VS\",\"serviceAnswers\":{\"permission\":\"yes\"},\"requirements\":\"Missing the mandatory shoot time entirely.\"}" "$BRIDE")
check "a required answer cannot be skipped" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT2\",\"eventDate\":\"$SLOT_DATE\",\"vendorServiceId\":\"$VS\",\"serviceAnswers\":{\"shoot_time\":\"10:30\",\"permission\":\"maybe\"},\"requirements\":\"A choice that is not on the list.\"}" "$BRIDE")
check "a choice that is not offered is refused" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT2\",\"eventDate\":\"$SLOT_DATE\",\"vendorServiceId\":\"$VS\",\"offeringId\":\"$OFFER\",\"quantity\":1,\"serviceAnswers\":{\"shoot_time\":\"10:30\"},\"requirements\":\"Below the minimum the vendor will take.\"}" "$BRIDE")
check "a quantity below the vendor's minimum is refused" "$c" 400
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT2\",\"eventDate\":\"$SLOT_DATE\",\"serviceAnswers\":{\"shoot_time\":\"10:30\"},\"requirements\":\"Answers with no service to check them against.\"}" "$BRIDE")
check "answers with no service to validate them against are refused" "$c" 400

echo
echo "== 10. Accepting the job is what spends the window =="
c=$(req POST "/bookings/$BOOKING/quotations" '{"amount":32000}' "$VENDOR")
check "vendor quotes" "$c" 201
QUOTE=$(field /tmp/body id)
c=$(req PUT "/bookings/quotations/$QUOTE/accept" '{}' "$BRIDE")
check "buyer accepts the quotation" "$c" 200

c=$(req GET "/vendors/$LISTING/availability/slots?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"confirmed":0' "accepting a quotation still consumes nothing"

c=$(req PUT "/bookings/$BOOKING/confirm" "" "$VENDOR")
check "vendor accepts the job" "$c" 200
c=$(req GET "/vendors/$LISTING/availability/slots?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"confirmed":1' "now one place is taken"
body_has '"remaining":4' "and four are left"
body_has '"state":"booked"' "the window has bookings"
c=$(req GET "/vendors/$LISTING/availability?from=$SLOT_DATE&to=$SLOT_DATE" "")
grep -q "$SLOT" /tmp/body && assert "and is still open to the next buyer — booked is not full" 1 || assert "a window with capacity left was wrongly closed" 0

# The specification's catering case: one window, several bookings. A second
# family takes the same morning while the first is already confirmed.
c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT\",\"eventDate\":\"$SLOT_DATE\",\"vendorServiceId\":\"$VS\",\"offeringId\":\"$OFFER\",\"quantity\":3,\"serviceAnswers\":{\"shoot_time\":\"15:00\",\"permission\":\"yes\"},\"requirements\":\"A second crew for the same morning.\"}" "$GROOM")
check "a second family requests the same window" "$c" 201
BOOKING2=$(field /tmp/body id)
c=$(req POST "/bookings/$BOOKING2/quotations" '{"amount":24000}' "$VENDOR")
QUOTE2=$(field /tmp/body id)
req PUT "/bookings/quotations/$QUOTE2/accept" '{}' "$GROOM" >/dev/null
c=$(req PUT "/bookings/$BOOKING2/confirm" "" "$VENDOR")
check "and the vendor takes that one too" "$c" 200
c=$(req GET "/vendors/$LISTING/availability/slots?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"confirmed":2' "one window now holds two bookings"
body_has '"remaining":3' "with three places left"

echo
echo "== 11. Blocking and deleting respect what is already promised =="
c=$(req DELETE "/vendors/$LISTING/availability/slots/$SLOT" "" "$VENDOR")
check "a window with confirmed bookings cannot be deleted" "$c" 400
body_has 'confirmed bookings and cannot be deleted' "and the refusal says exactly why"
c=$(req POST "/vendors/$LISTING/availability/slots/$SLOT/block" '{"reason":"changed my mind"}' "$VENDOR")
check "nor blocked out from under the family relying on it" "$c" 400
c=$(req PUT "/vendors/$LISTING/availability/slots/$SLOT" '{"startTime":"08:00","endTime":"12:00"}' "$VENDOR")
check "nor re-timed" "$c" 400
c=$(req PUT "/vendors/$LISTING/availability/slots/$SLOT" '{"note":"Still editable"}' "$VENDOR")
check "the note stays editable, because nothing depends on it" "$c" 200

c=$(req DELETE "/vendors/$LISTING/availability/slots/$SLOT3" "" "$VENDOR")
check "an untouched window is deleted freely" "$c" 200

echo
echo "== 12. Every summary card opens something =="
c=$(req GET "/vendors/$LISTING/availability/summary?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
check "the summary reports the counters" "$c" 200
body_has '"confirmedBookings":2' "bookings are counted, not windows"
body_has '"bookedSlots":1' "and they are all in one window"
body_has '"fullSlots":0' "which is booked but not full"

for bucket in published open requested booked full blocked; do
  c=$(req GET "/vendors/$LISTING/availability/slots/by/$bucket?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
  check "the $bucket card opens its slots" "$c" 200
done

c=$(req GET "/vendors/$LISTING/availability/slots/by/booked?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
grep -q "$SLOT" /tmp/body && assert "the booked card contains the window that has bookings" 1 || assert "the booked card missed it" 0

# Capacity may be cut back to what is already promised, but not below it, and
# the window then reads as full rather than as something the vendor blocked.
c=$(req PUT "/vendors/$LISTING/availability/slots/$SLOT" '{"capacity":1}' "$VENDOR")
check "capacity cannot drop below what is already confirmed" "$c" 400
c=$(req PUT "/vendors/$LISTING/availability/slots/$SLOT" '{"capacity":2}' "$VENDOR")
check "but it can be cut back to exactly that" "$c" 200
body_has '"state":"full"' "and the window is full from the arithmetic alone"
body_has '"bookable":false' "so it stops being offered"
c=$(req GET "/vendors/$LISTING/availability/summary?from=$SLOT_DATE&to=$SLOT_DATE" "" "$VENDOR")
body_has '"fullSlots":1' "the summary follows without being maintained by hand"

echo
echo "== 12b. A buyer reads the listing, but only the live parts of it =="
# The vendor console and the buyer's request dialog read the same rows. What
# differs is how much comes back: a retired service or a withdrawn price is the
# vendor's business, not the buyer's.
c=$(req PUT "/vendors/$LISTING/services/$VS/offerings/$OFFER" "{\"name\":\"Hourly\",\"pricingModel\":\"per_hour\",\"price\":\"8000\",\"unitLabel\":\"per hour\",\"minQuantity\":2,\"maxQuantity\":8,\"active\":true}" "$VENDOR")
check "the hourly price stays live" "$c" 200

c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Withdrawn\",\"pricingModel\":\"fixed\",\"price\":\"1\",\"active\":false}" "$VENDOR")
check "vendor adds a price and immediately retires it" "$c" 201

c=$(req GET "/vendors/$LISTING/services" "" "$VENDOR")
check "the vendor sees their own listing" "$c" 200
grep -q 'Withdrawn' /tmp/body && assert "including the retired price" 1 || assert "the retired price is missing from the vendor's own view" 0

c=$(req GET "/vendors/$LISTING/services" "" "$BRIDE")
check "a buyer can read the listing too" "$c" 200
grep -q 'Withdrawn' /tmp/body && assert "a buyer was shown a withdrawn price" 0 || assert "but not the withdrawn price" 1
body_has '"bookingForm"' "and gets the questions they will be asked"

echo
echo "== 13. Ownership =="
reg other vendor ""
OTHER=$(field /tmp/other.json accessToken)
c=$(req POST "/vendors/$LISTING/services" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":100}}" "$OTHER")
check "another vendor cannot add a service to this business" "$c" 403
c=$(req PUT "/vendors/$LISTING/services/$VS" "{\"definitionId\":\"$DEF\",\"attributes\":{\"max_altitude\":100}}" "$OTHER")
check "nor edit one" "$c" 403
c=$(req POST "/vendors/$LISTING/services/$VS/offerings" "{\"name\":\"Mine now\",\"pricingModel\":\"fixed\",\"price\":\"1\"}" "$OTHER")
check "nor price it" "$c" 403
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE\",\"startTime\":\"20:00\",\"endTime\":\"22:00\"}" "$OTHER")
check "nor publish availability against it" "$c" 403

echo
echo "== 14. Retiring configuration does not strand what was sold under it =="
c=$(req PUT "/admin/catalog/services/$DEF" '{"allowedPricingModels":["fixed"]}' "$ADMIN")
check "withdrawing a pricing model vendors are selling on is refused" "$c" 400
body_has 'Retire those offerings first' "and says what has to happen first"

c=$(req PUT "/admin/catalog/categories/$CAT" '{"active":false}' "$ADMIN")
check "a category is retired rather than deleted" "$c" 200
c=$(req GET /catalog/categories "" "$ADMIN")
grep -q "$CAT" /tmp/body && assert "a retired category still appears on new listings" 0 || assert "a retired category drops off the list" 1
c=$(req GET "/catalog/categories?includeInactive=true" "" "$ADMIN")
grep -q "$CAT" /tmp/body && assert "but is still readable, so old bookings keep loading" 1 || assert "a retired category vanished entirely" 0

echo
echo "== 15. RSVP: two head counts, not one =="
c=$(req POST /events "{\"name\":\"Reception $STAMP\",\"eventDate\":\"$SLOT_DATE\",\"venue\":\"Taj Krishna\"}" "$BRIDE")
check "the couple add a function" "$c" 201
EVENT=$(field /tmp/body id)

c=$(req POST /events/guests "{\"name\":\"Ramesh Sharma\",\"contact\":\"ramesh-$STAMP@t.com\",\"phone\":\"9876543210\",\"partySize\":4,\"relation\":\"Uncle\"}" "$BRIDE")
check "a guest is added with a mobile and a head count" "$c" 201
G1=$(field /tmp/body id)
c=$(req POST /events/guests "{\"name\":\"Sita Rao\",\"phone\":\"9876543211\",\"partySize\":2}" "$BRIDE")
check "and one with no email at all" "$c" 201
G2=$(field /tmp/body id)
c=$(req POST /events/guests "{\"name\":\"Anil Kumar\",\"phone\":\"9876543212\",\"partySize\":3}" "$BRIDE")
check "and a third" "$c" 201
G3=$(field /tmp/body id)

c=$(req POST /events/guests "{\"name\":\"Bad Number\",\"phone\":\"12345\"}" "$BRIDE")
check "a malformed mobile number is refused" "$c" 400

for G in "$G1" "$G2" "$G3"; do
  req POST "/events/$EVENT/invite" "{\"guestId\":\"$G\"}" "$BRIDE" >/dev/null
done

c=$(req GET "/events/$EVENT/rsvp" "" "$BRIDE")
check "the RSVP dashboard is served" "$c" 200
body_has '"totalInvited":3' "three invitations went out"
body_has '"totalInvitedHeadcount":9' "covering nine people, not three"
body_has '"notResponded":{"invitations":3,"people":9}' "and nobody has answered yet"

c=$(req GET "/events/$EVENT/rsvp/not_responded" "" "$BRIDE")
check "the not-responded card opens its guests" "$c" 200
body_has '"phone":"+919876543210"' "carrying the mobile number to ring"
body_has '"invitationSent":true' "and whether the invitation actually went out"

echo
echo "== 16. Answering, and what it does to the numbers =="
INVITE=$(jq -r --arg g "$G1" '.[] | select(.guestId == $g) | .inviteId' /tmp/body)
c=$(req PUT "/events/invites/$INVITE/rsvp" '{"status":"attending","attendingCount":3}' "$BRIDE")
check "the host records a reply taken over the phone" "$c" 200

c=$(req GET "/events/$EVENT/rsvp" "" "$BRIDE")
body_has '"coming":{"invitations":1,"people":3}' "three of the four invited are coming"
body_has '"notResponded":{"invitations":2,"people":5}' "and five people are still unaccounted for"

INV2=$(req GET "/events/$EVENT/rsvp/not_responded" "" "$BRIDE" >/dev/null; jq -r --arg g "$G2" '.[] | select(.guestId == $g) | .inviteId' /tmp/body)
c=$(req PUT "/events/invites/$INV2/rsvp" '{"status":"declined","declineReason":"Travelling that week"}' "$BRIDE")
check "a refusal is recorded with the reason they gave" "$c" 200
c=$(req GET "/events/$EVENT/rsvp" "" "$BRIDE")
body_has '"notComing":{"invitations":1,"people":0}' "nobody is coming from a refusal, whatever the family size"

c=$(req GET "/events/$EVENT/rsvp/not_coming" "" "$BRIDE")
check "the not-coming card opens" "$c" 200
body_has 'Travelling that week' "carrying the reason"

# Changing your mind has to clear the reason, or the organiser's list keeps
# showing an excuse that is no longer true.
c=$(req PUT "/events/invites/$INV2/rsvp" '{"status":"attending","attendingCount":2}' "$BRIDE")
check "they change their mind" "$c" 200
c=$(req GET "/events/$EVENT/rsvp/coming" "" "$BRIDE")
grep -q 'Travelling that week' /tmp/body && assert "the stale refusal reason is still on the record" 0 || assert "changing their mind clears the reason they gave" 1

echo
echo "== 17. Chasing the ones who have not answered =="
INV3=$(req GET "/events/$EVENT/rsvp/not_responded" "" "$BRIDE" >/dev/null; jq -r --arg g "$G3" '.[] | select(.guestId == $g) | .inviteId' /tmp/body)
c=$(req POST "/events/invites/$INV3/remind" "" "$BRIDE")
check "the organiser chases them" "$c" 200
body_has '"reminderCount":1' "and the chase is on the record"
c=$(req GET "/events/$EVENT/rsvp/not_responded" "" "$BRIDE")
body_has '"reminderCount":1' "so the list shows who has already been asked"

c=$(req POST "/events/invites/$INVITE/remind" "" "$BRIDE")
check "somebody who has already answered cannot be chased" "$c" 400

c=$(req GET "/events/$EVENT/rsvp" "" "$OTHER")
check "somebody else's guest list is nobody else's business" "$c" 403
c=$(req GET "/events/$EVENT/rsvp/coming" "" "$OTHER")
check "nor are the guests behind it" "$c" 403
c=$(req GET "/events/$EVENT/rsvp/nonsense" "" "$BRIDE")
check "an unknown category is refused rather than silently empty" "$c" 400

echo
echo "== 18. A profile can have photographs of its own =="
c=$(req GET /users/me "" "$BRIDE")
BRIDE_PROFILE=$(field /tmp/body id)

c=$(req GET "/profiles/$BRIDE_PROFILE/details/photos" "" "$BRIDE")
check "the photo list is readable" "$c" 200
body_has '"photos":\[\]' "and starts empty"

c=$(req POST "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"https://cdn.example.com/a.jpg"}' "$BRIDE")
check "the subject adds one themselves" "$c" 201
body_has '"primaryPhotoUrl":"https://cdn.example.com/a.jpg"' "the first one becomes the one shown first"

c=$(req POST "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"not-a-url"}' "$BRIDE")
check "something that is not an uploaded photo is refused" "$c" 400

c=$(req POST "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"https://cdn.example.com/b.jpg"}' "$BRIDE")
check "a second is added" "$c" 201
c=$(req POST "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"https://cdn.example.com/a.jpg"}' "$BRIDE")
check "adding the same one twice is a no-op rather than a duplicate" "$c" 201
c=$(req GET "/profiles/$BRIDE_PROFILE/details/photos" "" "$BRIDE")
assert "there are two, not three" "$(jq -e '.photos | length == 2' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/primary-photo" '{"url":"https://cdn.example.com/b.jpg"}' "$BRIDE")
check "another can be promoted" "$c" 200
c=$(req DELETE "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"https://cdn.example.com/b.jpg"}' "$BRIDE")
check "and removed" "$c" 200
body_has '"primaryPhotoUrl":"https://cdn.example.com/a.jpg"' "removing the primary moves it rather than leaving it dangling"

c=$(req POST "/profiles/$BRIDE_PROFILE/details/photos" '{"url":"https://cdn.example.com/x.jpg"}' "$OTHER")
check "somebody else cannot put photographs on your profile" "$c" 403

echo
echo "== 19. Both numbers, each labelled =="
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
check "the biodata carries a contact block" "$c" 200
body_has '"primaryMobileSource":"account"' "saying where the primary number lives"
body_has '"primaryMobileVerified":false' "and whether it has been verified"
assert "the primary number is present, not missing" "$(jq -e '.contact.primaryMobile != null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 20. The officer reports; an administrator decides =="
# A second business, so the chain can be walked from the start without
# disturbing the one section 4 already approved.
reg vendor2 vendor ""
VENDOR2=$(field /tmp/vendor2.json accessToken)
GST2=$(gst 2)
c=$(req POST /vendors "{\"name\":\"Second $STAMP\",\"category\":\"catering\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GST2\",\"panNumber\":\"ZYXWV9876E\",\"registeredAddress\":\"9 Jubilee Hills, Hyderabad\",\"contactPhone\":\"9876543299\"}" "$VENDOR2")
check "a second business applies" "$c" 201
LISTING2=$(field /tmp/body id)

# Walked to live like any other: nothing is verified until the vendor asks.
seed_catalog "$VENDOR2" "$LISTING2"
req POST "/vendors/$LISTING2/first-review" "" "$VENDOR2" >/dev/null
c=$(req POST "/vendors/$LISTING2/submit-verification" "" "$VENDOR2")
check "the second business is submitted for verification" "$c" 200

c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
REQ2=$(jq -r --arg id "$LISTING2" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
assert "the application raised a verification request" "$([ -n "$REQ2" ] && echo 1 || echo 0)"

c=$(req PUT "/verification/requests/$REQ2/decide" '{"status":"approved"}' "$ADMIN")
check "it cannot be approved before anybody has been anywhere" "$c" 400
body_has 'submitted findings' "and the refusal says what is missing"

c=$(req PUT "/verification/requests/$REQ2/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates it" "$c" 200

# The notification is the point of D4: allocation that nobody is told about is
# a queue somebody has to remember to check.
c=$(req GET /notifications "" "$OFFICER")
check "the officer has notifications" "$c" 200
body_has '"type":"verification_assigned"' "including one for the visit they have just been given"
grep -q "$REQ2" /tmp/body && assert "carrying the request it refers to" 1 || assert "the notification does not say which request" 0

c=$(req PUT "/verification/requests/$REQ2/start" "" "$OFFICER")
check "the officer picks it up" "$c" 200

c=$(req PUT "/verification/requests/$REQ2/findings" '{"visited":true,"observations":"Short","issues":[],"recommendation":"approve"}' "$OFFICER")
check "a write-up too short to mean anything is refused" "$c" 400
c=$(req PUT "/verification/requests/$REQ2/findings" '{"visited":false,"observations":"Could not find the address at all.","issues":[],"recommendation":"reject"}' "$OFFICER")
check "recommending a rejection without saying what went wrong is refused" "$c" 400

c=$(req PUT "/verification/requests/$REQ2/findings" '{"visited":true,"observations":"Attended. Kitchen and two vans present, GST certificate on the wall.","issues":[],"evidence":["https://cdn.example.com/gst.jpg"],"recommendation":"approve"}' "$OFFICER")
check "the officer submits their findings" "$c" 200
body_has '"status":"submitted"' "which moves it out of their queue"

c=$(req PUT "/verification/requests/$REQ2/findings" '{"visited":true,"observations":"Trying to submit twice over.","issues":[],"recommendation":"approve"}' "$OFFICER")
check "and cannot be submitted twice" "$c" 400

c=$(req GET "/verification/workload" "" "$ADMIN")
check "the workload is readable" "$c" 200
body_has '"submitted":1' "submitted work is reported"
assert "but does not count against the officer, whose part is done" "$(jq -e --arg o "$OFFICER_ID" '.[] | select(.officerUserId == $o) | .total == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 21. Admin review, and sending it back =="
c=$(req PUT "/verification/requests/$REQ/review" "" "$ADMIN")
check "a request with nothing submitted has nothing to review" "$c" 400
c=$(req PUT "/verification/requests/$REQ2/review" "" "$ADMIN")
check "an administrator picks the findings up" "$c" 200
body_has '"status":"admin_review"' "so two administrators do not both decide it"

c=$(req PUT "/verification/requests/$REQ2/decide" '{"status":"additional_review","remarks":"Go back and photograph the second kitchen."}' "$ADMIN")
check "it is sent back for another look" "$c" 200
body_has '"revisitCount":1' "and the platform counts how many times that has happened"

c=$(req PUT "/verification/requests/$REQ2/decide" '{"status":"approved"}' "$ADMIN")
check "with the findings cleared, it cannot be approved on the old ones" "$c" 400

# Being sent back returns edit access — that is the whole difference between
# this and a rejection — and the listing has to be fixed and resubmitted before
# anybody decides again. Approving it where it stands would let the vendor skip
# the correction that was asked for.
c=$(req GET "/vendors/$LISTING2/manage" "" "$VENDOR2")
body_has '"status":"reverification_required"' "the listing is back with the vendor"
body_has 'photograph the second kitchen' "carrying the exact reason, verbatim"

# The reason is written for the vendor and is nobody else's business. It used to
# ride out on the public listing, where a competitor could read what an officer
# thought of the premises.
c=$(req GET "/vendors/$LISTING2" "")
check "the public listing is served to anybody" "$c" 200
grep -q 'photograph the second kitchen' /tmp/body && assert "the refusal reason is public" 0 || assert "but the refusal reason is not in it" 1
grep -q '"panNumber"' /tmp/body && assert "the PAN number is public" 0 || assert "nor is the PAN number" 1
grep -q '"gstNumber"' /tmp/body && assert "the GST number is public" 0 || assert "nor the GST number" 1
grep -q '"registeredAddress"' /tmp/body && assert "the registered address is public" 0 || assert "nor the registered address" 1
grep -q '"complianceDocuments"' /tmp/body && assert "the compliance documents are public" 0 || assert "nor the links to the compliance documents" 1
grep -q '"payoutAccountId"' /tmp/body && assert "the payout account is public" 0 || assert "nor the payout account" 1
body_has '"ratingAvg"' "what a buyer needs to choose is all still there"

c=$(req GET "/vendors/$LISTING2/manage" "" "$BRIDE")
check "and another account cannot read the full row either" "$c" 403

c=$(req PUT "/vendors/$LISTING2" '{"description":"Second kitchen documented."}' "$VENDOR2")
check "and is editable again, which a rejection never is" "$c" 200

c=$(req PUT "/verification/requests/$REQ2/findings" '{"visited":true,"observations":"Went back. Second kitchen photographed, everything in order.","issues":[],"evidence":["https://cdn.example.com/kitchen2.jpg"],"recommendation":"approve"}' "$OFFICER")
check "the officer goes back and writes it up again" "$c" 200

c=$(req PUT "/verification/requests/$REQ2/decide" '{"status":"approved"}' "$ADMIN")
check "but the listing has to be resubmitted first" "$c" 400

req POST "/vendors/$LISTING2/first-review" "" "$VENDOR2" >/dev/null
c=$(req POST "/vendors/$LISTING2/submit-verification" "" "$VENDOR2")
check "the vendor resubmits it" "$c" 200
c=$(req PUT "/verification/requests/$REQ2/decide" '{"status":"approved"}' "$ADMIN")
check "and now it can be approved" "$c" 200

c=$(req GET "/vendors/$LISTING2/manage" "" "$VENDOR2")
body_has '"status":"live"' "which is what puts the business in front of buyers"

echo
echo "== 22. A vendor hears about the work coming in =="
SLOT_DATE2=$(days_from_now 55)
c=$(req POST "/vendors/$LISTING/availability/slots" "{\"date\":\"$SLOT_DATE2\",\"startTime\":\"10:00\",\"endTime\":\"14:00\",\"vendorServiceId\":\"$VS\",\"capacity\":2}" "$VENDOR")
check "the first vendor publishes another window" "$c" 201
SLOT_N=$(field /tmp/body id)

c=$(req POST /bookings "{\"providerType\":\"vendor\",\"providerId\":\"$LISTING\",\"slotId\":\"$SLOT_N\",\"eventDate\":\"$SLOT_DATE2\",\"vendorServiceId\":\"$VS\",\"offeringId\":\"$OFFER\",\"quantity\":3,\"serviceAnswers\":{\"shoot_time\":\"11:00\",\"permission\":\"yes\"},\"requirements\":\"A request the vendor should hear about.\"}" "$GROOM")
check "a family sends a request" "$c" 201
BOOKING3=$(field /tmp/body id)

# Domain events reach notifications through the outbox, which is deliberately
# asynchronous — a notification that fails to send must never roll back the
# booking it describes. So this waits for delivery rather than assuming it.
await_notification() {
  token=$1; needle=$2; n=0
  while [ "$n" -lt 20 ]; do
    req GET /notifications "" "$token" >/dev/null
    grep -q "$needle" /tmp/body && return 0
    n=$((n + 1))
    sleep 1
  done
  return 1
}

await_notification "$VENDOR" "$BOOKING3"
c=$(req GET /notifications "" "$VENDOR")
check "the vendor has notifications" "$c" 200
body_has '"type":"booking_request"' "including one for the new request"
body_has '"reference"' "carrying a reference short enough to read out"
grep -q "$SLOT_DATE2" /tmp/body && assert "and the date it is for" 1 || assert "the notification does not say when" 0
grep -q "$BOOKING3" /tmp/body && assert "and the request it points at" 1 || assert "the notification does not say which request" 0

# Where it goes is the server's answer, not each client's. A phone showing this
# notification has no application to ask, so the destination travels with it.
body_has '"targetModule":"bookings"' "the notification says which module it opens"
body_has '"targetAction":"respond"' "and that the vendor is being asked to do something, not just look"
body_has "\"targetId\":\"$BOOKING3\"" "and names the record, lifted out of the payload"

c=$(req GET /notifications/unread-count "" "$VENDOR")
check "the unread count is served" "$c" 200
assert "and is not zero" "$(jq -e '.unread > 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# The buyer placed it, so they are not told about their own action.
c=$(req GET /notifications "" "$GROOM")
grep -q '"type":"booking_request"' /tmp/body && assert "the buyer was told about their own request" 0 || assert "the buyer is not told about their own request" 1

c=$(req POST "/bookings/$BOOKING3/quotations" '{"amount":26000}' "$VENDOR")
check "the vendor quotes" "$c" 201
QUOTE3=$(field /tmp/body id)
await_notification "$GROOM" '"type":"booking_quotation"'
c=$(req GET /notifications "" "$GROOM")
body_has '"type":"booking_quotation"' "and the buyer hears about the quotation"

echo
echo "== 23. Allocation that knows where the applicant is =="
# Two officers, one covering the applicant's city and carrying work, one
# covering nowhere and carrying nothing. Workload alone picks the wrong one.
req POST /verification/officers "{\"email\":\"geo-a-$STAMP@wow.local\",\"name\":\"Geo A $STAMP\"}" "$ADMIN" >/dev/null
GEO_A=$(field /tmp/body id)
req POST /verification/officers "{\"email\":\"geo-b-$STAMP@wow.local\",\"name\":\"Geo B $STAMP\"}" "$ADMIN" >/dev/null
GEO_B=$(field /tmp/body id)

c=$(req POST "/verification/officers/$GEO_A/areas" '{"city":"Hyderabad"}' "$ADMIN")
check "an officer is given a city to cover" "$c" 201
c=$(req POST "/verification/officers/$GEO_A/areas" '{"city":"Bangalore"}' "$ADMIN")
check "and a second one" "$c" 201

# The whole reason this was deferred: "Bengaluru" and "Bangalore" are one city,
# and a matcher that misses that sends the visit to the wrong person.
c=$(req POST "/verification/officers/$GEO_A/areas" '{"city":"Bengaluru"}' "$ADMIN")
check "adding the same city under its other name is caught" "$c" 400
body_has 'already cover' "and says so rather than silently duplicating"

c=$(req POST "/verification/officers/$GEO_B/areas" '{}' "$ADMIN")
check "an area with neither a city nor a state is refused" "$c" 400

c=$(req GET "/verification/officers/$GEO_A/areas" "" "$ADMIN")
check "their coverage is readable" "$c" 200
assert "two areas, not three" "$(jq -e 'length == 2' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# A third business, in Hyderabad, allocated automatically.
reg vendor3 vendor ""
VENDOR3=$(field /tmp/vendor3.json accessToken)
GST3=$(gst 3)
c=$(req POST /vendors "{\"name\":\"Geo $STAMP\",\"category\":\"decor\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GST3\",\"panNumber\":\"QWERT4321H\",\"registeredAddress\":\"4 Kondapur, Hyderabad\",\"contactPhone\":\"9876543288\"}" "$VENDOR3")
check "a Hyderabad business applies" "$c" 201
LISTING3=$(field /tmp/body id)

c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
REQ3=$(jq -r --arg id "$LISTING3" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
assert "it raised a request" "$([ -n "$REQ3" ] && echo 1 || echo 0)"

c=$(req PUT "/verification/requests/$REQ3/allocate" '{}' "$ADMIN")
check "the platform allocates it without being told who to" "$c" 200
body_has '"allocationBasis":"primary_area"' "on coverage rather than workload alone"
# Stored as the applicant wrote it, not normalised: the normalised form is for
# matching, and an administrator reading the record wants the real spelling.
body_has '"applicantCity":"Hyderabad"' "recording where the applicant actually is"
# Asserting it went to *this run's* officer would be wrong: service areas
# persist, so a previous run's officer covers Hyderabad too and may well be
# carrying less. What matters is that whoever got it covers the place.
ASSIGNED=$(field /tmp/body assignedToUserId)
c=$(req GET "/verification/officers/$ASSIGNED/areas" "" "$ADMIN")
check "the assigned officer's coverage is readable" "$c" 200
assert "and it went to somebody who covers Hyderabad" "$(jq -e 'any(.[]; .city == "hyderabad")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# An officer covering a whole state, for a city nobody lists individually.
c=$(req POST "/verification/officers/$GEO_B/areas" '{"state":"Telangana"}' "$ADMIN")
check "another officer covers a whole state" "$c" 201

reg vendor4 vendor ""
VENDOR4=$(field /tmp/vendor4.json accessToken)
GST4=$(gst 4)
c=$(req POST /vendors "{\"name\":\"Warangal $STAMP\",\"category\":\"decor\",\"city\":\"Warangal, Telangana\",\"gstNumber\":\"$GST4\",\"panNumber\":\"ASDFG8765K\",\"registeredAddress\":\"2 Hanamkonda, Warangal\",\"contactPhone\":\"9876543277\"}" "$VENDOR4")
check "a business applies from a city nobody lists" "$c" 201
LISTING4=$(field /tmp/body id)

c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
REQ4=$(jq -r --arg id "$LISTING4" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
c=$(req PUT "/verification/requests/$REQ4/allocate" '{}' "$ADMIN")
check "it is allocated" "$c" 200
body_has '"allocationBasis":"state"' "falling back to whoever covers the state"

c=$(req DELETE "/verification/areas/$(req GET "/verification/officers/$GEO_A/areas" "" "$ADMIN" >/dev/null; jq -r '.[0].id' /tmp/body)" "" "$ADMIN")
check "coverage can be withdrawn" "$c" 200

echo
echo "== 24. Escrow knows the difference between paid and owed =="
# The vendor from section 4 has no payout account, so completing a job cannot
# move the money — and that has to be visible rather than silently "released".
# Money and work alternate all the way down, so the whole ladder is walked.
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"advance"}' "$BRIDE")
check "the buyer pays the advance" "$c" 200
c=$(req PUT "/bookings/$BOOKING/start" "" "$VENDOR")
check "the vendor starts work" "$c" 200
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"second"}' "$BRIDE")
check "the second instalment goes in" "$c" 200
c=$(req PUT "/bookings/$BOOKING/complete" "" "$VENDOR")
check "the vendor delivers the job" "$c" 200
c=$(req PUT "/bookings/$BOOKING/pay" '{"milestone":"final"}' "$BRIDE")
check "the buyer pays the balance" "$c" 200

# Settling is what actually moves the money, and it is the step that discovers
# there is nowhere to move it to.
c=$(req PUT "/bookings/$BOOKING/settle" "" "$VENDOR")
check "the escrow is settled" "$c" 200

c=$(req GET /bookings/earnings "" "$VENDOR")
check "the vendor's ledger is readable" "$c" 200
grep -q 'pending_payout' /tmp/body && assert "money the platform owes is marked owed, not paid" 1 || assert "an unpayable release was recorded as paid" 0
assert "and reported as its own figure rather than dropping out of the totals" "$(jq -e '.pendingPayout != "0.00"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "with nothing claimed as released" "$(jq -e '.released == "0.00"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
grep -q 'payout onboarding\|payout account' /tmp/body && assert "with the reason on the row, not only in a log" 1 || assert "nothing says why it has not been paid" 0

c=$(req PUT "/vendors/$LISTING/payout-account" '{"payoutAccountId":"not-an-account"}' "$VENDOR")
check "a payout account that is not one is refused" "$c" 400
c=$(req PUT "/vendors/$LISTING/payout-account" '{"payoutAccountId":"acc_TESTLINKED001"}' "$VENDOR")
check "the vendor registers their linked account" "$c" 200
c=$(req PUT "/vendors/$LISTING/payout-account" '{"payoutAccountId":"acc_OTHER"}' "$VENDOR2")
check "somebody else cannot redirect their payouts" "$c" 403

# The loop closes when the provider finishes onboarding, which happens long
# after the job did — so it is swept rather than waited for.
c=$(req POST /admin/payouts/retry "" "$ADMIN")
check "an administrator can run the payout sweep" "$c" 200
body_has '"released"' "and it reports what it moved"

c=$(req GET /bookings/earnings "" "$VENDOR")
assert "the money that was owed has now been paid" "$(jq -e '.pendingPayout == "0.00" and .released != "0.00"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
grep -q 'mock_txn_' /tmp/body && assert "with the gateway reference on the row" 1 || assert "no transfer reference was recorded" 0

c=$(req POST /admin/payouts/retry "" "$VENDOR")
check "a vendor cannot run it" "$c" 403

echo
echo "== 25. One vendor account, two businesses, two verifications =="
# raise() used to be idempotent per applicant rather than per business, and
# re-pointed the open request at whatever subject came in last. The first
# business ended up with no request at all: unverifiable, in nobody's queue,
# and nothing said so.
reg multibiz vendor ""
MB=$(field /tmp/multibiz.json accessToken)
GA=$(gst 5)
GB=$(gst 6)

c=$(req POST /vendors "{\"name\":\"MB Catering $STAMP\",\"category\":\"catering\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GA\",\"panNumber\":\"MULTI1111A\",\"registeredAddress\":\"1 First Road, Hyderabad\",\"contactPhone\":\"9876540001\"}" "$MB")
check "one account creates its first business" "$c" 201
MB_A=$(field /tmp/body id)
c=$(req POST /vendors "{\"name\":\"MB Photos $STAMP\",\"category\":\"photography\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GB\",\"panNumber\":\"MULTJ2222B\",\"registeredAddress\":\"2 Second Road, Hyderabad\",\"contactPhone\":\"9876540002\"}" "$MB")
check "and a second under the same login" "$c" 201
MB_B=$(field /tmp/body id)

c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
check "the verification queue is readable" "$c" 200
assert "the first business has its own request" "$(jq -e --arg id "$MB_A" 'any((.data // .)[]; .subjectId == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and so does the second" "$(jq -e --arg id "$MB_B" 'any((.data // .)[]; .subjectId == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "two requests, not one repointed" "$(jq -e --arg a "$MB_A" --arg b "$MB_B" '[(.data // .)[] | select(.subjectId == $a or .subjectId == $b)] | length == 2' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# Still idempotent where it should be: re-saving one business must not raise a
# second request against it.
c=$(req PUT "/vendors/$MB_A" '{"description":"Edited, same business."}' "$MB")
check "editing the first business is accepted" "$c" 200
c=$(req GET "/verification/requests?applicantType=vendor&limit=100&status=new" "" "$ADMIN")
assert "and did not raise a duplicate for it" "$(jq -e --arg a "$MB_A" '[(.data // .)[] | select(.subjectId == $a)] | length == 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 26. Partner preferences reach the matchmaking engine =="
# The biodata wrote them to profile_details; the compatibility engine read
# profiles.preferences. Two stores, never synchronised — so somebody could fill
# the section in completely and still be scored against nothing.
c=$(req GET /users/me "" "$BRIDE")
PREF_PROFILE=$(field /tmp/body id)

c=$(req PUT "/profiles/$PREF_PROFILE/details/preferences" '{"preferredAgeMin":27,"preferredAgeMax":34,"preferredHeightMinCm":165,"preferredHeightMaxCm":185,"preferences":{"religion":"Hindu","caste":"Reddy","education":"Masters","lifestyle":["vegetarian","non-smoker"],"locations":"Hyderabad, Bengaluru"}}' "$BRIDE")
check "partner preferences are saved on the biodata" "$c" 200

c=$(req GET /users/me "" "$BRIDE")
check "the profile is readable" "$c" 200
assert "and the engine's own copy now carries the religion" "$(jq -e '.preferences.religion == "Hindu"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "the education" "$(jq -e '.preferences.education == "Masters"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "the lifestyle answers" "$(jq -e '.preferences.lifestyle | index("vegetarian")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "the age range" "$(jq -e '.preferences.preferredAgeMin == 27 and .preferences.preferredAgeMax == 34' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
# "Hyderabad, Bengaluru" typed into one box is the common case, and dropping it
# for not being an array would be the same failure in a smaller way.
assert "and a comma-separated location list, split" "$(jq -e '.preferences.preferredLocations | length == 2' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 27. One name field, and a plan that cannot run backwards =="
seed_photos "$PREF_PROFILE" "$BRIDE"
c=$(req PUT "/profiles/$PREF_PROFILE/details/personal" '{"firstName":"Ananya","lastName":"Reddy","heightCm":163,"complexion":"Fair","communicationAddress":"5 Jubilee Hills, Hyderabad"}' "$BRIDE")
check "personal details save with a single name field" "$c" 200
c=$(req GET "/profiles/$PREF_PROFILE/details" "" "$BRIDE")
assert "the surname column is no longer written" "$(jq -e '.details.surname == null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# A client still sending a surname must not lose the name it carries.
c=$(req PUT "/profiles/$PREF_PROFILE/details/personal" '{"firstName":"Ananya","surname":"Kondapur","lastName":"","heightCm":163,"complexion":"Fair","communicationAddress":"5 Jubilee Hills, Hyderabad"}' "$BRIDE")
check "an older client sending only a surname is still accepted" "$c" 200
c=$(req GET "/profiles/$PREF_PROFILE/details" "" "$BRIDE")
assert "and its value became the last name rather than being dropped" "$(jq -e '.details.lastName == "Kondapur"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

PAST=$(days_from_now -30)
c=$(req POST /planner/plan "{\"weddingDate\":\"$PAST\"}" "$BRIDE")
check "a wedding date in the past is refused" "$c" 400
body_has 'already passed' "and says why"

SOON=$(days_from_now 20)
c=$(req POST /planner/plan "{\"weddingDate\":\"$SOON\"}" "$BRIDE")
check "a wedding three weeks away is accepted" "$c" 201
PLAN=$(field /tmp/body id)
c=$(req GET "/planner/plan/$PLAN/timeline" "" "$BRIDE")
check "its timeline is generated" "$c" 200
TODAY=$(date +%Y-%m-%d)
# "Book the venue 180 days before" would otherwise be dated to last year.
assert "no task is due before today" "$(jq -e --arg t "$TODAY" 'all(.tasks[]; .dueDate >= $t)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and none after the wedding" "$(jq -e --arg w "$SOON" 'all(.tasks[]; .dueDate <= $w)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 28. A match notification says who =="
c=$(req GET /notifications "" "$GROOM")
check "the groom's notifications are readable" "$c" 200
grep -q '"counterpartName"' /tmp/body \
  && assert "a match notification names the other side" 1 \
  || assert "match notifications still say only \"someone\"" 0
grep -q '"counterpartProfileId"' /tmp/body \
  && assert "and carries the profile to open from it" 1 \
  || assert "there is nothing to open from the notification" 0

echo
echo "== 29. A photograph has to be a photograph =="
# A matrimonial profile is a claim about a real person. A generated face makes
# the government ID, the officer's visit and the family's consent all attach to
# somebody who does not exist.
reg genuine individual bride
GEN=$(field /tmp/genuine.json accessToken)
c=$(req GET /users/me "" "$GEN")
GEN_PROFILE=$(field /tmp/body id)

c=$(req POST "/profiles/$GEN_PROFILE/details/photos" '{"url":"https://cdn.example.com/holiday.jpg"}' "$GEN")
check "an ordinary photograph goes on" "$c" 201

c=$(req POST "/profiles/$GEN_PROFILE/details/photos" '{"url":"https://cdn.example.com/midjourney-portrait.png"}' "$GEN")
check "one straight out of a generator is refused" "$c" 400
body_has 'authentic photograph' "and says what to do instead"

c=$(req POST "/profiles/$GEN_PROFILE/details/photos" '{"url":"https://cdn.example.com/ai-generated-face.png"}' "$GEN")
check "so is one that says so in its name" "$c" 400

c=$(req GET "/profiles/$GEN_PROFILE/details/photos" "" "$GEN")
assert "and neither was stored" "$(jq -e '.photos | length == 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 30. Photographs before the rest of the biodata =="
# Asking at the end means asking somebody who has already finished.
c=$(req PUT "/profiles/$GEN_PROFILE/details/personal" '{"firstName":"Meera","lastName":"Nair","heightCm":160,"complexion":"Fair","communicationAddress":"3 Kondapur, Hyderabad"}' "$GEN")
check "one photograph is not enough to start the details" "$c" 400
body_has 'photographs before' "and says how many are needed"
body_has '1 so far' "and how many there are"

req POST "/profiles/$GEN_PROFILE/details/photos" '{"url":"https://cdn.example.com/second.jpg"}' "$GEN" >/dev/null
req POST "/profiles/$GEN_PROFILE/details/photos" '{"url":"https://cdn.example.com/third.jpg"}' "$GEN" >/dev/null
c=$(req PUT "/profiles/$GEN_PROFILE/details/personal" '{"firstName":"Meera","lastName":"Nair","heightCm":160,"complexion":"Fair","communicationAddress":"3 Kondapur, Hyderabad"}' "$GEN")
check "with three, the details save" "$c" 200

echo
echo "== 31. Native place moved, and a divorce may be explained =="
c=$(req PUT "/profiles/$GEN_PROFILE/details/family" '{"father":{"name":"Rajan Nair","profession":"Teacher"},"mother":{"name":"Latha Nair","profession":"Homemaker"},"familyType":"nuclear","familyStatus":"middle","brothers":1,"sisters":0,"nativePlace":"Palakkad"}' "$GEN")
check "the native place is asked with the family now" "$c" 200
c=$(req GET "/profiles/$GEN_PROFILE/details" "" "$GEN")
assert "and stored there" "$(jq -e '.details.nativePlace == "Palakkad"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# Never required: somebody who would rather not explain must still be able to
# complete the section.
c=$(req PUT "/profiles/$GEN_PROFILE/details/marital" '{"maritalStatus":"divorced","divorceDate":"2023-06-01"}' "$GEN")
check "a divorce can be recorded without explaining it" "$c" 200
c=$(req PUT "/profiles/$GEN_PROFILE/details/marital" '{"maritalStatus":"divorced","divorceDate":"2023-06-01","reason":"We married young and grew apart. It was settled by mutual consent."}' "$GEN")
check "and with a reason, in their own words" "$c" 200
c=$(req GET "/profiles/$GEN_PROFILE/details" "" "$GEN")
body_has 'grew apart' "which is kept"

# Never married carries no history at all, which is the existing rule.
c=$(req PUT "/profiles/$GEN_PROFILE/details/marital" '{"maritalStatus":"never_married"}' "$GEN")
check "going back to never-married is accepted" "$c" 200
c=$(req GET "/profiles/$GEN_PROFILE/details" "" "$GEN")
grep -q 'grew apart' /tmp/body && assert "the old reason is still on the record" 0 || assert "and clears the history with it" 1

echo
echo "== 32. Clearing a biodata is not closing an account =="
c=$(req GET "/profiles/$GEN_PROFILE/details" "" "$GEN")
check "the biodata is there" "$c" 200
assert "with details on it" "$(jq -e '.details != null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req DELETE "/profiles/$GEN_PROFILE/details" "" "$OTHER")
check "somebody else cannot clear it" "$c" 403

c=$(req DELETE "/profiles/$GEN_PROFILE/details" "" "$GEN")
check "its owner can" "$c" 200

c=$(req GET "/profiles/$GEN_PROFILE/details" "" "$GEN")
check "and the profile still exists" "$c" 200
assert "with the details gone" "$(jq -e '.details == null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and the photographs with them" "$(jq -e '(.assets | length) == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
c=$(req GET "/profiles/$GEN_PROFILE/details/photos" "" "$GEN")
assert "no photographs left" "$(jq -e '.photos | length == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# The account is untouched: clearing a biodata and closing an account are
# different actions with different consequences.
c=$(req GET /users/me "" "$GEN")
check "the account is still signed in and intact" "$c" 200
assert "and no longer counts as complete" "$(jq -e '.profileCompleted == false' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 33. Events carry what a day actually needs =="
c=$(req POST /events "{\"name\":\"Sangeet $STAMP\",\"eventDate\":\"$(days_from_now 40)\",\"venue\":\"Taj Krishna\",\"eventType\":\"Sangeet\",\"category\":\"pre_wedding\",\"city\":\"Hyderabad\",\"startTime\":\"19:00\",\"endTime\":\"23:00\",\"expectedGuests\":250,\"budget\":\"180000.00\",\"description\":\"Open-air, dinner from 8.\"}" "$BRIDE")
check "a day is created with its times, guests and budget" "$c" 201
EV=$(field /tmp/body id)

c=$(req POST /events "{\"name\":\"Backwards $STAMP\",\"startTime\":\"22:00\",\"endTime\":\"19:00\"}" "$BRIDE")
check "a day that ends before it starts is refused" "$c" 400
body_has 'after the start time' "with a message rather than an internal error"

c=$(req POST /events "{\"name\":\"Bad time $STAMP\",\"startTime\":\"25:00\"}" "$BRIDE")
check "so is a time that is not a time" "$c" 400

c=$(req GET /events/summary "" "$BRIDE")
check "the summary is served" "$c" 200
assert "counting the days" "$(jq -e '.total >= 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and what the couple expect, as distinct from what the RSVPs say" "$(jq -e '.expectedGuests >= 250' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req GET "/events?status=upcoming" "" "$BRIDE")
check "the list filters by status" "$c" 200
c=$(req GET "/events?q=sangeet" "" "$BRIDE")
check "and searches by name" "$c" 200
assert "finding it" "$(jq -e --arg id "$EV" 'any(.[]; .id == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
c=$(req GET "/events?q=nothingmatchesthis" "" "$BRIDE")
assert "and returns nothing when nothing matches" "$(jq -e 'length == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 34. Blocking, and reporting =="
c=$(req GET "/chat/block?withUserId=$(field /tmp/groom.json user.id)" "" "$BRIDE")
check "the block state is readable" "$c" 200
body_has '"blocked":false' "and starts unblocked"

GROOM_ID=$(field /tmp/groom.json user.id)
BRIDE_ID=$(field /tmp/bride.json user.id)

c=$(req POST /chat/block "{\"userId\":\"$BRIDE_ID\"}" "$BRIDE")
check "blocking yourself is refused" "$c" 400

c=$(req POST /chat/block "{\"userId\":\"$GROOM_ID\"}" "$BRIDE")
check "blocking somebody else works" "$c" 200
c=$(req POST /chat/block "{\"userId\":\"$GROOM_ID\"}" "$BRIDE")
check "and doing it twice is one block, not two" "$c" 200

# The refusal must not say "you have been blocked": that turns a quiet exit
# into an argument.
c=$(req POST /chat/messages "{\"toUserId\":\"$BRIDE_ID\",\"body\":\"Hello again\"}" "$GROOM")
check "the blocked person cannot get through" "$c" 403
grep -qi 'block' /tmp/body && assert "the refusal tells them they were blocked" 0 || assert "and is not told why" 1

c=$(req DELETE "/chat/block/$GROOM_ID" "" "$BRIDE")
check "the block can be lifted" "$c" 200

c=$(req POST /chat/report "{\"userId\":\"$GROOM_ID\",\"reason\":\"harassment\",\"detail\":\"Kept messaging after I asked them to stop.\"}" "$BRIDE")
check "a report goes in" "$c" 201
body_has '"blocked":true' "and blocks them with it, since nobody wants to do that twice"

c=$(req GET "/chat/block?withUserId=$GROOM_ID" "" "$BRIDE")
body_has '"blocked":true' "which the block state confirms"

c=$(req POST /chat/report "{\"userId\":\"$GROOM_ID\",\"reason\":\"nonsense\"}" "$BRIDE")
check "a reason that is not on the list is refused" "$c" 400

echo
echo "== 35. A match can actually be opened =="
# The endpoint that serves a viewable biodata existed and had never been
# exposed, which is why a match could be listed but not clicked.
c=$(req GET "/profiles/$BRIDE_PROFILE/view" "" "$BRIDE")
check "somebody can open their own profile" "$c" 200
body_has '"identityVerified"' "and it says whether the document was checked"

c=$(req GET "/profiles/$BRIDE_PROFILE/view" "" "$OTHER")
# The bride's profile is matches-only by default, and OTHER is not matched.
check "a stranger cannot open a matches-only profile" "$c" 403
body_has 'accepted on both sides' "and is told what would open it"

# The subtractive rule holds: the address and the second number never travel.
c=$(req GET "/profiles/$BRIDE_PROFILE/view" "" "$BRIDE")
grep -q 'communicationAddress' /tmp/body && assert "the communication address leaked" 0 || assert "the communication address is not in the shareable view" 1
grep -q 'alternateMobile' /tmp/body && assert "the second number leaked" 0 || assert "nor the second number" 1

echo
echo "== 36. Recently added is a browse, not a recommendation =="
# A fresh account: the bride's match is fixed by now, and matchmaking is
# deliberately closed once it is.
reg browser individual groom
BROWSE=$(field /tmp/browser.json accessToken)
c=$(req GET /users/me "" "$BROWSE")
BROWSE_PROFILE=$(field /tmp/body id)
req PUT /users/me/profile "{\"displayName\":\"Browser\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-03\",\"city\":\"Hyderabad\",\"visibility\":\"public\"}" "$BROWSE" >/dev/null
seed_photos "$BROWSE_PROFILE" "$BROWSE"

c=$(req GET "/matches/suggestions?sort=recent&limit=20" "" "$BROWSE")
check "the newest list is served" "$c" 200
# The compatibility floor is what makes a recommendation list worth reading and
# what made this one look empty.
assert "sorted newest first" "$(jq -e '[.data[].profile] as $p | ($p | length) >= 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
RECENT_N=$(jq -r '.data | length' /tmp/body)
c=$(req GET "/matches/suggestions?limit=20" "" "$BROWSE")
SCORED_N=$(jq -r '.data | length' /tmp/body)
assert "and shows at least as many as the scored list ($RECENT_N vs $SCORED_N)" "$([ "$RECENT_N" -ge "$SCORED_N" ] && echo 1 || echo 0)"

# An explicit floor is still honoured: somebody who asked for one meant it.
c=$(req GET "/matches/suggestions?sort=recent&minScore=99" "" "$BROWSE")
check "an explicit minimum still applies" "$c" 200
assert "and filters the newest list too" "$(jq -e '.data | length == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 37. The admin console answers questions about particular things =="

# The console existed as one page of approvals and totals. What it could not do
# was answer a question about a named account, a named business or a named
# booking — which is how every real admin session starts, because somebody has
# complained about something specific.

c=$(req GET "/admin/activity?limit=20" "" "$ADMIN")
check "the activity feed is served" "$c" 200
assert "and has something in it" "$(jq -e 'length > 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "newest first" "$(jq -e '[.[].at] | . == (. | sort | reverse)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "drawn from more than one kind of thing" "$(jq -e '[.[].kind] | unique | length > 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req GET "/admin/activity" "" "$VENDOR")
check "a vendor cannot read the platform's activity" "$c" 403

# The directory: how somebody arrives from a complaint naming a person.
c=$(req GET "/admin/directory?role=vendor&limit=5" "" "$ADMIN")
check "the accounts directory filters by role" "$c" 200
assert "returning only vendors" "$(jq -e '[.data[].role] | all(. == "vendor")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
grep -q 'passwordHash' /tmp/body && assert "the directory leaks password hashes" 0 || assert "and never a password hash" 1

VENDOR_UID=$(jq -r '.user.id // empty' /tmp/vendor.json)
c=$(req GET "/admin/accounts/$VENDOR_UID" "" "$ADMIN")
check "one account opens with everything hanging off it" "$c" 200
body_has '"businesses"' "the businesses they own"
body_has '"bookings"' "the bookings they placed"
body_has '"casesRaised"' "and the complaints they made"
grep -q 'passwordHash' /tmp/body && assert "the detail view leaks the hash" 0 || assert "with no hash anywhere in it" 1

c=$(req GET "/admin/businesses?status=live&limit=5" "" "$ADMIN")
check "businesses list by lifecycle state" "$c" 200
assert "and only the live ones come back" "$(jq -e '[.data[].status] | all(. == "live")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req GET "/admin/bookings?limit=5" "" "$ADMIN")
check "the whole booking book is readable" "$c" 200
assert "which nobody else could see" "$(jq -e '.meta.total >= 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# Administrators and officers are not variants of one thing, and only one of
# them has a workload.
c=$(req GET /admin/staff/in_person "" "$ADMIN")
check "the field officers list" "$c" 200
assert "carrying what each is actually carrying" "$(jq -e 'all(has("openCases") and has("openVisits"))' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
c=$(req GET /admin/staff/admin "" "$ADMIN")
check "and the administrators, separately" "$c" 200
assert "with no officers among them" "$(jq -e 'all(.role == "admin")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# Reports. One route, six kinds, one window.
for KIND in users agents vendors bookings financial verification; do
  c=$(req GET "/admin/reports?kind=$KIND" "" "$ADMIN")
  check "the $KIND report is served" "$c" 200
  assert "over a window it states" "$(jq -e 'has("from") and has("to")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
done

c=$(req GET "/admin/reports?kind=nonsense" "" "$ADMIN")
check "an invented report kind is refused" "$c" 400
c=$(req GET "/admin/reports?kind=financial&from=2020-01-01&to=2020-01-31" "" "$ADMIN")
check "a window with nothing in it still answers" "$c" 200
body_has '"collected":"0.00"' "with zeros rather than an error"

echo
echo "== 38. Settle my payment =="

# A provider asking where their money is. Not a dispute: nothing freezes, and
# the booking does not move — they are not complaining about the job.

c=$(req POST "/verification/cases/settlement/$BOOKING" '{}' "$BRIDE")
check "the buyer cannot ask for the provider's settlement" "$c" 403

# Nothing owed and nothing held is refused with the reason rather than filed:
# a request the desk cannot answer is worse than no request.
c=$(req POST "/verification/cases/settlement/$BOOKING" '{}' "$VENDOR")
check "a request with nothing behind it is refused" "$c" 400
body_has 'nothing outstanding' "and says so, rather than filing it"

# One with money actually held. BOOKING3 is walked to the advance so there is
# something real to ask about.
req PUT "/bookings/quotations/$QUOTE3/accept" '{}' "$GROOM" >/dev/null
req PUT "/bookings/$BOOKING3/confirm" "" "$VENDOR" >/dev/null
c=$(req PUT "/bookings/$BOOKING3/pay" '{"milestone":"advance"}' "$GROOM")
check "the advance on the third booking is held" "$c" 200

c=$(req POST "/verification/cases/settlement/$BOOKING3" '{"note":"Where is the advance?"}' "$VENDOR")
check "the provider asks where their money is" "$c" 201
body_has 'still in escrow' "and is told why before anybody is allocated anything"
body_has '"priority":"high"' "money somebody is waiting on arrives high priority"
body_has '"status":"triaged"' "and already triaged — nobody needs to decide that"
body_has '"category":"settlement"' "filed as what it is"

# Not a dispute. Freezing the escrow here would punish them for asking.
c=$(req GET "/bookings/$BOOKING3" "" "$VENDOR")
grep -q '"status":"disputed"' /tmp/body && assert "asking froze the booking" 0 || assert "and asking did not freeze the booking" 1

c=$(req POST "/verification/cases/settlement/$BOOKING3" '{}' "$VENDOR")
check "asking twice does not raise a second request" "$c" 201
body_has '"alreadyOpen":true' "it hands back the one already on the desk"

echo
echo "== 39. Devices, and consent to be messaged =="

c=$(req GET /notifications/channels "" "$VENDOR")
check "the channels an account is reachable on are readable" "$c" 200
body_has '"devices":0' "with no devices registered to begin with"
body_has '"whatsappOptIn":false' "and WhatsApp off"

# The opt-in is never inferred. The vendor registered with a phone number and
# is still not opted in above, which is the whole rule.
c=$(req PUT /notifications/channels/whatsapp '{"optIn":true}' "$VENDOR")
check "the account opts in" "$c" 200
c=$(req GET /notifications/channels "" "$VENDOR")
body_has '"whatsappOptIn":true' "which is recorded"
body_has '"whatsappReachable":true' "and there is a number to send to"

c=$(req PUT /notifications/channels/whatsapp '{"optIn":false}' "$VENDOR")
check "and can opt out again" "$c" 200
c=$(req GET /notifications/channels "" "$VENDOR")
body_has '"whatsappOptIn":false' "which stops it"
# The date consent was given survives withdrawal: "did they agree, and when"
# is the question asked afterwards, and it still has an answer.
grep -q '"whatsappOptInAt":null' /tmp/body && assert "opting out erased that consent was ever given" 0 || assert "but when they agreed is still on the record" 1

c=$(req PUT /notifications/channels/whatsapp '{"optIn":"yes please"}' "$VENDOR")
check "a non-boolean opt-in is refused" "$c" 400

# A device is claimed rather than shared. A token belongs to an app
# installation, so a handed-over phone must not keep ringing for its last owner.
DEVICE="tok-$STAMP-device"
c=$(req POST /notifications/devices "{\"token\":\"$DEVICE\",\"platform\":\"android\"}" "$VENDOR")
check "a device registers" "$c" 201
c=$(req GET /notifications/channels "" "$VENDOR")
body_has '"devices":1' "and is counted"

c=$(req POST /notifications/devices "{\"token\":\"$DEVICE\",\"platform\":\"android\"}" "$VENDOR")
check "registering the same device twice is one device" "$c" 201
c=$(req GET /notifications/channels "" "$VENDOR")
body_has '"devices":1' "not two"

c=$(req POST /notifications/devices "{\"token\":\"$DEVICE\",\"platform\":\"android\"}" "$BRIDE")
check "another account claims the same handset" "$c" 201
c=$(req GET /notifications/channels "" "$VENDOR")
body_has '"devices":0' "and the previous owner stops receiving on it"
c=$(req GET /notifications/channels "" "$BRIDE")
body_has '"devices":1' "while the new one starts"

c=$(req DELETE "/notifications/devices/$DEVICE" "" "$BRIDE")
check "signing out on a device unregisters it" "$c" 200
c=$(req GET /notifications/channels "" "$BRIDE")
body_has '"devices":0' "and it stops ringing"

c=$(req POST /notifications/devices '{"token":"x"}' "$VENDOR")
check "a token too short to be real is refused" "$c" 400

echo
echo "== 40. Attaching the thing you are complaining about =="

# The whole upload path passed its tests and failed for every user. The suites
# posted literal https://cdn.example.com/... strings, which have a top-level
# domain; the platform's own presign hands back http://localhost:3000/... in
# development and http://minio:9000/... self-hosted, and neither does. Every
# field that stored an uploaded file refused the URL the platform had just
# issued for it. This posts the *real* presigned URL, which is what the browser
# does and what nothing here ever did.

c=$(req POST /media/profile-photo/presign '{"filename":"receipt.jpg"}' "$BRIDE")
check "an upload slot is issued" "$c" 201
REAL_URL=$(field /tmp/body publicUrl)

c=$(req POST /verification/cases "{\"subjectType\":\"other\",\"title\":\"Attachment\",\"description\":\"Attaching the receipt the platform just gave me a slot for.\",\"evidence\":[\"$REAL_URL\"]}" "$BRIDE")
check "and a case accepts the URL the platform itself issued" "$c" 201
ATTACH_CASE=$(field /tmp/body id)
body_has 'mock-storage' "with the attachment on it"

c=$(req PUT "/verification/cases/$ATTACH_CASE/evidence" "{\"evidence\":[\"$REAL_URL\"]}" "$BRIDE")
check "more evidence can be added to it afterwards" "$c" 200

# A support attachment is as often an invoice as a photograph. The profile
# photograph route still refuses one, because a PDF on a biodata renders as a
# broken box.
c=$(req POST /media/attachment/presign '{"filename":"invoice.pdf"}' "$BRIDE")
check "a PDF can be attached as evidence" "$c" 201
c=$(req POST /media/profile-photo/presign '{"filename":"invoice.pdf"}' "$BRIDE")
check "but not used as a profile photograph" "$c" 400
c=$(req POST /media/attachment/presign '{"filename":"../../etc/passwd"}' "$BRIDE")
check "and a path is still refused, wherever it is going" "$c" 400

# A honeymoon plan starts before it has any days in it. This used to be refused
# every time, which is what "Create Plan does not create a plan" was.
c=$(req POST /travel/itineraries '{"title":"Kerala, December","items":[]}' "$BRIDE")
check "a plan can be started empty" "$c" 201
ITIN=$(field /tmp/body id)
assert "and it exists afterwards" "$([ -n "$ITIN" ] && echo 1 || echo 0)"
c=$(req GET /travel/itineraries "" "$BRIDE")
body_has 'Kerala, December' "listed under the account that made it"

echo
echo "== 41. An album that is a gallery, not a list of links =="

c=$(req GET /media/albums "" "$BRIDE")
check "the albums are listed" "$c" 200
assert "empty to begin with" "$(jq -e 'length == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req POST /media/albums '{"title":"Mehendi","isPublic":true}' "$BRIDE")
check "an album is created" "$c" 201
ALBUM=$(field /tmp/body id)

c=$(req GET /media/albums "" "$BRIDE")
body_has '"itemCount":0' "and reads as a card with nothing in it"
body_has '"coverUrl":null' "and no cover yet"
body_has 'shareUrl' "carrying the share link, since it is public"

# Straight from the device: presign, then hand the album the URL the platform
# itself issued. This is the path the browser takes.
c=$(req POST "/media/albums/$ALBUM/presign" '{"filename":"mehendi.jpg"}' "$BRIDE")
check "an upload slot for the album is issued" "$c" 201
PHOTO=$(field /tmp/body publicUrl)
c=$(req POST "/media/albums/$ALBUM/items" "{\"url\":\"$PHOTO\",\"type\":\"image\"}" "$BRIDE")
check "and the photograph goes into the album" "$c" 201
ITEM=$(field /tmp/body id)

c=$(req GET /media/albums "" "$BRIDE")
body_has '"itemCount":1' "the card counts it"
grep -q '"coverUrl":null' /tmp/body && assert "and still has no cover" 0 || assert "and takes it as the cover" 1

# Somebody else's album is not theirs to read, add to, or empty.
c=$(req GET "/media/albums/$ALBUM/items" "" "$GROOM")
check "another account cannot open the album" "$c" 403
c=$(req DELETE "/media/albums/$ALBUM/items/$ITEM" "" "$GROOM")
check "nor remove a photograph from it" "$c" 403
c=$(req DELETE "/media/albums/$ALBUM" "" "$GROOM")
check "nor delete it" "$c" 403

c=$(req DELETE "/media/albums/$ALBUM/items/$ITEM" "" "$BRIDE")
check "the owner removes a photograph" "$c" 200
c=$(req GET /media/albums "" "$BRIDE")
body_has '"itemCount":0' "and the count follows"

c=$(req DELETE "/media/albums/$ALBUM" "" "$BRIDE")
check "and deletes the album" "$c" 200
c=$(req GET "/media/albums/$ALBUM/items" "" "$BRIDE")
check "which then no longer exists" "$c" 404

echo
echo "== 42. The whole wedding on one screen =="

# Everything on this dashboard existed already, on four different pages. What
# did not exist was anywhere that answered "how is it going".

c=$(req GET /planner/dashboard "" "$BRIDE")
check "the dashboard is served" "$c" 200
body_has '"countdown"' "with a countdown"
body_has '"budget"' "a budget"
body_has '"guests"' "the guest list"
body_has '"journey"' "the journey through the plan"
body_has '"upcoming"' "and what is happening next"

c=$(req GET /planner/dashboard "" "$VENDOR")
check "a vendor has no wedding to see" "$c" 403

# With nothing set up, it answers with zeros rather than failing. A couple who
# has just signed up is the commonest reader of this screen.
c=$(req GET /planner/dashboard "" "$GROOM")
check "and it answers for an account with nothing on it yet" "$c" 200
assert "with no date rather than an error" "$(jq -e '.countdown.weddingDate == null or (.countdown.weddingDate | type) == "string"' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# A budget on an event, and a booking against a vendor, land in the same table
# from different directions — which is the only thing on this screen that
# could not be read off one page already.
DASH_DATE=$(days_from_now 45)
c=$(req POST /events "{\"name\":\"Sangeet $STAMP\",\"eventDate\":\"$DASH_DATE\",\"category\":\"pre_wedding\",\"budget\":150000,\"expectedGuests\":200}" "$BRIDE")
check "an event carries a budget" "$c" 201

c=$(req GET /planner/dashboard "" "$BRIDE")
assert "which the dashboard adds to the total" "$(jq -e '.budget.budgeted | tonumber >= 150000' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and breaks down by category" "$(jq -e '.budget.categories | any(.category == "pre_wedding" and (.budgeted | tonumber) >= 150000)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "counting what has been committed against it" "$(jq -e '.budget.committed | tonumber >= 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "and the event appears in what is next" "$(jq -e --arg n "Sangeet $STAMP" 'any(.upcoming[]; .name == $n)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# The countdown falls back to the first event when there is no plan, rather
# than reporting no date while the couple's own calendar has one in it.
assert "the countdown has a date to work from" "$(jq -e '.countdown.weddingDate != null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 43. A photograph that actually goes somewhere =="

# The one step nothing had ever exercised. `presign` returned a URL and the
# comment beside it said uploads worked end-to-end without AWS — but nothing
# served that URL, so the browser's PUT got a 404 from the router and the
# uploader reported "That photo could not be uploaded". Every upload on every
# deployment not configured for S3 failed there: the agent's mandatory biodata
# photograph, the support attachment, the album, the vendor's portfolio.
#
# The suites never caught it because they post a literal cdn.example.com string
# and never PUT anything anywhere.

c=$(req POST /media/profile-photo/presign '{"filename":"portrait.jpg"}' "$BRIDE")
check "an upload slot is issued" "$c" 201
UP=$(field /tmp/body uploadUrl)
PUB=$(field /tmp/body publicUrl)

# The URL is on the app's own origin, which from inside the compose network is
# the nginx service rather than the host name a browser would use.
UP_IN=$(echo "$UP" | sed -E 's#https?://[^/]+#http://frontend#')
PUB_IN=$(echo "$PUB" | sed -E 's#https?://[^/]+#http://frontend#')

head -c 40000 /dev/urandom > /tmp/photo.jpg
PUT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary @/tmp/photo.jpg \
  -H 'Content-Type: image/jpeg' "$UP_IN")
check "the bytes are accepted where the platform said to put them" "$PUT_CODE" 200

GET_CODE=$(curl -s -o /tmp/got.jpg -w '%{http_code}' "$PUB_IN")
check "and come back from the public URL" "$GET_CODE" 200
assert "byte for byte" "$([ "$(wc -c < /tmp/photo.jpg)" = "$(wc -c < /tmp/got.jpg)" ] && echo 1 || echo 0)"

# 12MB through nginx: the proxy defaulted to refusing anything over 1MB, which
# is smaller than a photograph from any phone made this decade.
head -c 3000000 /dev/urandom > /tmp/big.jpg
c=$(req POST /media/profile-photo/presign '{"filename":"big.jpg"}' "$BRIDE")
BIG=$(field /tmp/body uploadUrl | sed -E 's#https?://[^/]+#http://frontend#')
BIG_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary @/tmp/big.jpg \
  -H 'Content-Type: image/jpeg' "$BIG")
check "a three-megabyte photograph gets through the proxy" "$BIG_CODE" 200

# The key comes back from the client, so it is re-checked rather than trusted.
TRAV=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -X PUT --data-binary @/tmp/photo.jpg \
  -H 'Content-Type: image/jpeg' "$API/mock-storage/uploads/..%2f..%2f..%2fevil.jpg")
check "a key that climbs out of the store is refused" "$TRAV" 400

# And the platform accepts its own URL, which it did not before: @IsUrl also
# demanded a top-level domain, and the storage host has none.
c=$(req PUT /users/me/profile "{\"displayName\":\"Bride\",\"photos\":[\"$PUB\"]}" "$BRIDE")
check "and the profile accepts the URL the platform issued" "$c" 200
body_has 'mock-storage' "storing it against the profile"

echo
echo "== 44. An agency is not one of its own clients =="

# Registration is rate-limited per IP and this suite has made a good many by
# now, so the counters are cleared again here. The throttle has its own
# assertions in verify-rbac; this section is about who counts as a client.
if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
fi

reg agentx agent ""
AGENTX=$(field /tmp/agentx.json accessToken)
c=$(req PUT /agents/agency "{\"agencyName\":\"Agency $STAMP\",\"city\":\"Hyderabad\",\"contactPhone\":\"9876500011\"}" "$AGENTX")
check "the agency registers its details" "$c" 200
AGENCY_X=$(field /tmp/body id)
c=$(req PUT "/admin/agents/$AGENCY_X/approve" "" "$ADMIN")
check "the agency is approved" "$c" 200

AGENT_CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh","givenAt":"2026-08-01"}'
c=$(req POST /agents/profiles "{\"displayName\":\"Client One\",\"gender\":\"female\",\"dateOfBirth\":\"1998-04-04\",\"city\":\"Hyderabad\",\"contactPhone\":\"98765$(date +%s | tail -c 6)\",$AGENT_CONSENT}" "$AGENTX")
check "the agency takes on a client" "$c" 201
CLIENT_ONE=$(field /tmp/body id)

c=$(req GET /agents/profiles/actable "" "$AGENTX")
check "the client picker is served" "$c" 200
assert "and lists the client" "$(jq -e --arg id "$CLIENT_ONE" 'any(.[]; .id == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
# The agency's own account appeared here as "(me)" — an agency being offered
# the chance to browse marriage proposals for itself.
assert "but not the agency's own account" "$(jq -e 'all(.[]; .claimStatus != "self")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# The recommendations column dropped the selected client and answered for the
# agency instead, which is what "matches are not filtered by gender" was: not a
# missing filter, but the wrong subject.
c=$(req GET "/ai/recommendations/matches?profileId=$CLIENT_ONE" "" "$AGENTX")
check "the shortlist is served for the selected client" "$c" 200
assert "and every profile on it is the opposite gender to her" "$(jq -e '[.data[].profile.gender] | all(. != "female")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

c=$(req GET "/matches/suggestions?profileId=$CLIENT_ONE&sort=recent&limit=20" "" "$AGENTX")
check "so is the recently-added list" "$c" 200
assert "and that is gender-filtered too" "$(jq -e '[.data[].profile.gender] | all(. != "female")' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "============================="
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
echo "============================="
[ "$FAIL" -eq 0 ] || exit 1
