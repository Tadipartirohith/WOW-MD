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

# Wedding services stay locked until a match is fixed, so the buyer in this
# suite has to get married first. That rule is exercised properly in
# verify-phase1; here it is setup, done in as few steps as possible.
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
GST=$(printf '29ABCDE%04dF1Z5' "$((RANDOM % 10000))")
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

c=$(req GET "/verification/requests?applicantType=vendor" "" "$ADMIN")
REQ=$(jq -r --arg id "$LISTING" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
[ -z "$REQ" ] && REQ=$(jq -r '(.data // .)[-1].id' /tmp/body)
c=$(req PUT "/verification/requests/$REQ/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN")
check "admin allocates the visit to the officer" "$c" 200
req PUT "/verification/requests/$REQ/start" "" "$OFFICER" >/dev/null
c=$(req PUT "/verification/requests/$REQ/decide" '{"status":"approved"}' "$OFFICER")
check "officer approves the business after the visit" "$c" 200

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
echo "============================="
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
echo "============================="
[ "$FAIL" -eq 0 ] || exit 1
