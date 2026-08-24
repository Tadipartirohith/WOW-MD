#!/bin/sh
# Live verification of the Phase 2 work: the sectioned client biodata and its
# Aadhaar verification, the notification feed, the provider's accounts ledger,
# the chat dashboard and presence, event management with per-event vendors,
# honeymoon package search, and the match filters.
#
# Runs from inside the compose network, same as the other suites:
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" \
#     alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-phase2.sh"
#
# Needs MAIL_PROVIDER=log and AADHAAR_PROVIDER=mock: in those modes invitation
# links and the OTP code come back on the response, because nothing is actually
# delivered.
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

jqok() { jq -e "$1" /tmp/body >/dev/null 2>&1 && echo 1 || echo 0; }
field() { jq -r ".$2 // empty" "$1"; }

# Three photographs before the details. A biodata with no picture is one
# nobody looks at, so the section that starts the form now requires them.
seed_photos() { # seed_photos <profileId> <token>
  for n in 1 2 3; do
    req POST "/profiles/$1/details/photos" "{\"url\":\"https://cdn.example.com/seed-$1-$n.jpg\"}" "$2" >/dev/null
  done
}


# An Aadhaar number carries a Verhoeff check digit and is unique platform-wide
# by design, so the suite cannot reuse a fixed one — the second run would
# collide with the first and fail for a reason that has nothing to do with what
# is being tested. This builds a fresh valid number per run: eleven digits from
# the clock, plus the check digit that makes them valid.
#
# One character in the Verhoeff table was wrong here for a while — row 6 read
# 6598715432 where it should read 6598710432 — and because that cell is only
# reached by some inputs, the generator produced a valid number about four
# times in five. The suite then failed roughly one run in five, pointing at the
# Aadhaar endpoint, which was correct all along. The table is now indexed with
# substr() out of one string per row so a row can be read against the standard
# at a glance, and the permutation table is generated rather than typed.
verhoeff() {
  awk -v body="$1" '
    function cell(table, row, col) { return substr(table, row * 10 + col + 1, 1) + 0 }
    BEGIN {
      D = "0123456789" "1234067895" "2340178956" "3401289567" "4012395678" "5987604321" "6598710432" "7659821043" "8765932104" "9876543210";
      INV = "0432156789";

      # The permutation table is generated from its first row rather than typed
      # out: eight hand-copied rows is eight chances to introduce a
      # transposition into the very check that exists to catch transpositions.
      P = "0123456789";
      prev = "0123456789";
      for (r = 1; r <= 7; r++) {
        row = "";
        for (c = 0; c < 10; c++) {
          row = row substr("1576283094", substr(prev, c + 1, 1) + 1, 1);
        }
        P = P row;
        prev = row;
      }

      n = length(body);
      c = 0;
      for (i = 1; i <= n; i++) {
        digit = substr(body, n - i + 1, 1) + 0;
        c = cell(D, c, cell(P, i % 8, digit));
      }
      printf "%d", substr(INV, c + 1, 1);
    }'
}
AADHAAR_BODY="2$(date +%s | tail -c 8)$(printf '%03d' $(( $$ % 1000 )))"
AADHAAR="${AADHAAR_BODY}$(verhoeff "$AADHAAR_BODY")"
AADHAAR_LAST4=$(echo "$AADHAAR" | tail -c 5)

REG_PHONE_BASE=$(date +%s | tail -c 7)
regphone() { printf '9%s%03d' "$REG_PHONE_BASE" "$((700 + $1))"; }
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

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

# A well-formed uuid that is deliberately not a real booking.
FAKE_BOOKING="00000000-0000-4000-8000-0000000000ff"

echo
echo "== 1. Personas =="
reg bride individual bride
reg groom individual groom
reg vendor vendor
BRIDE=$(field /tmp/bride.json accessToken)
GROOM=$(field /tmp/groom.json accessToken)
VENDOR=$(field /tmp/vendor.json accessToken)

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin signs in" "$c" 200
ADMIN=$(field /tmp/body accessToken)

PREFS='{"religion":"hindu","community":"kamma","preferredAgeMin":24,"preferredAgeMax":34,"preferredLocations":["Hyderabad"]}'
req PUT /users/me/profile "{\"displayName\":\"Bride Kumari\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Groom Reddy\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"visibility\":\"public\",\"preferences\":$PREFS}" "$GROOM" >/dev/null

c=$(req GET /users/me "" "$BRIDE")
BRIDE_PROFILE=$(field /tmp/body id)
c=$(req GET /users/me "" "$GROOM")
GROOM_PROFILE=$(field /tmp/body id)

echo
echo "== 2. The account's own profile redisplays what was saved =="
c=$(req PUT /users/me/profile '{"displayName":"Bride Kumari","address":"14 Banjara Hills, Hyderabad 500034","contactPhone":"9876500011"}' "$BRIDE")
check "address and an alternate mobile save" "$c" 200
c=$(req GET /users/me "" "$BRIDE")
assert "the address reads back" "$(jqok '.address == "14 Banjara Hills, Hyderabad 500034"')"
assert "and the mobile came back in E.164" "$(jqok '.contactPhone == "+919876500011"')"

c=$(req PUT /users/me/profile '{"displayName":"Bride 99"}' "$BRIDE")
check "a name with digits in it is refused" "$c" 400
c=$(req PUT /users/me/profile '{"displayName":"Bride Kumari","contactPhone":"12345"}' "$BRIDE")
check "and so is a malformed mobile" "$c" 400

echo
echo "== 3. The biodata saves a section at a time =="
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
check "an empty biodata still reads" "$c" 200
assert "nothing is complete yet" "$(jqok '.completion.complete == false')"
assert "and every required section is listed as missing" "$(jqok '.completion.missing | length >= 7')"

seed_photos "$BRIDE_PROFILE" "$BRIDE"
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/personal" '{"firstName":"Anjali","lastName":"Kumari","heightCm":163,"complexion":"Fair","communicationAddress":"14 Banjara Hills, Hyderabad"}' "$BRIDE")
check "personal details save on their own" "$c" 200

c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "and only that section is now complete" "$(jqok '[.completion.sections[] | select(.complete)] | length == 1')"
assert "an unanswered horoscope is NOT read as \"we do not keep one\"" "$(jqok '[.completion.sections[] | select(.section == "horoscope")] | .[0].complete == false')"
assert "progress is reported as a percentage" "$(jqok '.completion.percent > 0 and .completion.percent < 100')"

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/religion" '{"religion":"Hindu","caste":"Kamma","subCaste":"None","motherTongue":"Telugu"}' "$BRIDE")
check "religion saves" "$c" 200

# Answering "no horoscope" completes the section — plenty of families do not
# keep one, and a section that can only be completed by inventing a rashi is a
# section that gets filled with fiction.
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/horoscope" '{"horoscopeAvailable":false}' "$BRIDE")
check "declining a horoscope completes that section" "$c" 200
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "horoscope counts as complete" "$(jqok '[.completion.sections[] | select(.section == "horoscope")] | .[0].complete == true')"

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/horoscope" '{"horoscopeAvailable":true,"rashi":"Simha","star":"Magha","gothram":"Kashyapa"}' "$BRIDE")
check "and it can be filled in later" "$c" 200
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/horoscope" '{"horoscopeAvailable":false}' "$BRIDE")
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "turning it back off clears the chart rather than leaving a stale rashi" "$(jqok '.details.horoscope == {}')"

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/marital" '{"maritalStatus":"never_married"}' "$BRIDE")
check "marital status saves" "$c" 200
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "never-married carries no history" "$(jqok '.details.maritalHistory == {}')"

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/family" '{"father":{"name":"Ramesh Kumar","profession":"Retired"},"mother":{"name":"Lakshmi Kumari"},"familyType":"nuclear","familyStatus":"Middle class","brothers":1,"sisters":0}' "$BRIDE")
check "family saves" "$c" 200
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/education" '{"highestQualification":"M.Tech","course":"Computer Science","occupationStatus":"employed","employment":{"company":"Infosys","designation":"Senior Engineer","salary":"18 LPA"},"incomeVisible":false}' "$BRIDE")
check "education and occupation save" "$c" 200

c=$(req PUT "/profiles/$BRIDE_PROFILE/details/preferences" '{"preferredAgeMin":36,"preferredAgeMax":28,"preferredHeightMinCm":165,"preferredHeightMaxCm":190}' "$BRIDE")
check "an inverted age range is refused" "$c" 400
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/preferences" '{"preferredAgeMin":26,"preferredAgeMax":36,"preferredHeightMinCm":168,"preferredHeightMaxCm":190}' "$BRIDE")
check "partner preferences save" "$c" 200

c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "identity is the only section still outstanding" "$(jqok '.completion.missing == ["identity"]')"

echo
echo "== 4. Siblings and assets =="
c=$(req POST "/profiles/$BRIDE_PROFILE/details/siblings" '{"name":"Arun Kumar","age":29,"maritalStatus":"never_married","profession":"Doctor"}' "$BRIDE")
check "a sibling is added" "$c" 201
SIBLING=$(field /tmp/body id)
c=$(req POST "/profiles/$BRIDE_PROFILE/details/assets" '{"type":"independent_house","location":"Guntur","visible":false}' "$BRIDE")
check "a family asset is recorded" "$c" 201
ASSET=$(field /tmp/body id)

c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "both come back on the biodata" "$(jqok '(.siblings | length == 1) and (.assets | length == 1)')"

c=$(req DELETE "/profiles/$BRIDE_PROFILE/details/siblings/$SIBLING" "" "$BRIDE")
check "a sibling can be removed" "$c" 200
c=$(req DELETE "/profiles/$BRIDE_PROFILE/details/assets/$ASSET" "" "$BRIDE")
check "and so can an asset" "$c" 200

echo
echo "== 5. Somebody else's biodata is not yours to edit =="
c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$GROOM")
check "another user cannot read it" "$c" 403
c=$(req PUT "/profiles/$BRIDE_PROFILE/details/personal" '{"firstName":"Someone","lastName":"Else","heightCm":170,"complexion":"Fair","communicationAddress":"Z"}' "$GROOM")
check "nor write to it" "$c" 403

echo
echo "== 6. Aadhaar: verified, hashed, and never stored =="
c=$(req POST "/profiles/$BRIDE_PROFILE/identity/aadhaar/send-otp" '{"aadhaarNumber":"123456789012"}' "$BRIDE")
check "a number failing the check digit is refused" "$c" 400
c=$(req POST "/profiles/$BRIDE_PROFILE/identity/aadhaar/send-otp" "{\"aadhaarNumber\":\"$AADHAAR\"}" "$BRIDE")
check "a valid number starts an OTP session" "$c" 200
SESSION=$(field /tmp/body sessionId)
CODE=$(field /tmp/body devCode)
assert "the session is addressed by an opaque id" "$(jqok '.sessionId != null')"
assert "and the number itself is not echoed back" "$(grep -qv "$AADHAAR" /tmp/body && echo 1 || echo 0)"

c=$(req POST "/profiles/$BRIDE_PROFILE/identity/aadhaar/verify-otp" "{\"sessionId\":\"$SESSION\",\"code\":\"000000\"}" "$BRIDE")
check "a wrong code is refused" "$c" 400
c=$(req POST "/profiles/$BRIDE_PROFILE/identity/aadhaar/verify-otp" "{\"sessionId\":\"$SESSION\",\"code\":\"$CODE\"}" "$BRIDE")
check "the right code verifies" "$c" 200

c=$(req GET "/profiles/$BRIDE_PROFILE/identity/aadhaar" "" "$BRIDE")
check "verification state reads back" "$c" 200
assert "it is marked verified" "$(jqok '.verifiedAt != null')"
assert "only the last four digits are kept" "$(jq -e --arg l "$AADHAAR_LAST4" '.last4 == $l' /tmp/body >/dev/null && echo 1 || echo 0)"
assert "and the full number is nowhere in the response" "$(grep -qv "$AADHAAR" /tmp/body && echo 1 || echo 0)"

c=$(req GET "/profiles/$BRIDE_PROFILE/details" "" "$BRIDE")
assert "the biodata is now complete end to end" "$(jqok '.completion.complete == true')"

echo
echo "== 7. One document, one profile =="
c=$(req POST "/profiles/$GROOM_PROFILE/identity/aadhaar/send-otp" "{\"aadhaarNumber\":\"$AADHAAR\"}" "$GROOM")
check "the same Aadhaar cannot be attached to a second profile" "$c" 409

echo
echo "== 8. Notifications =="
c=$(req GET /notifications "" "$BRIDE")
check "the feed reads" "$c" 200
c=$(req GET /notifications/unread-count "" "$BRIDE")
check "the bell has a count" "$c" 200
assert "which is a number" "$(jqok '.unread >= 0')"
c=$(req PUT /notifications/read-all '{}' "$BRIDE")
check "and everything can be cleared at once" "$c" 200
c=$(req GET /notifications/unread-count "" "$BRIDE")
assert "after which nothing is unread" "$(jqok '.unread == 0')"

echo
echo "== 9. The provider's accounts ledger =="
c=$(req GET /bookings/earnings "" "$VENDOR")
check "a vendor can read their account" "$c" 200
assert "held and released are reported separately" "$(jqok 'has("heldInEscrow") and has("released")')"
assert "with the ledger behind them" "$(jqok 'has("ledger")')"
c=$(req GET /bookings/earnings "" "$BRIDE")
check "a buyer has no seller account to read" "$c" 403

echo
echo "== 10. Chat: an accepted match is reachable before a word is said =="
c=$(req POST /matches/interest "{\"toProfileId\":\"$GROOM_PROFILE\"}" "$BRIDE")
check "the bride sends an interest" "$c" 201
INTEREST=$(field /tmp/body id)
c=$(req PUT "/matches/$INTEREST/accept" '{}' "$GROOM")
check "the groom accepts" "$c" 200

c=$(req GET /chat/conversations "" "$BRIDE")
check "the chat dashboard reads" "$c" 200
assert "the new match appears with nothing said yet" "$(jqok '[.[] | select(.lastMessage == null)] | length >= 1')"
assert "and it is addressed by the OTHER person, not by yourself" "$(jq -e --arg me "$(jq -r '.user.id' /tmp/bride.json)" '[.[] | select(.withUserId == $me)] | length == 0' /tmp/body >/dev/null && echo 1 || echo 0)"
assert "each row carries a name rather than a uuid" "$(jqok '.[0].displayName != null')"

GROOM_ID=$(jq -r '.user.id' /tmp/groom.json)
c=$(req POST /chat/messages "{\"toUserId\":\"$GROOM_ID\",\"body\":\"Namaste, would you like to talk?\"}" "$BRIDE")
check "the bride sends the first message" "$c" 201

c=$(req GET /chat/conversations "" "$GROOM")
assert "it shows unread on the groom's side" "$(jqok '[.[] | select(.unread > 0)] | length == 1')"
assert "with the last message on the row" "$(jqok '[.[] | select(.lastMessage != null)] | length == 1')"

BRIDE_ID=$(jq -r '.user.id' /tmp/bride.json)
c=$(req PUT "/chat/messages/read?withUserId=$BRIDE_ID" '{}' "$GROOM")
check "opening the thread marks it read" "$c" 200
c=$(req GET /chat/conversations "" "$GROOM")
assert "and the badge clears" "$(jqok '[.[] | select(.unread > 0)] | length == 0')"

c=$(req GET "/chat/presence?withUserId=$BRIDE_ID" "" "$GROOM")
check "presence reads" "$c" 200
assert "somebody with no socket open is not shown as online" "$(jqok '.online == false')"

echo
echo "== 11. Events: the wedding is several days, each with its own vendors =="
c=$(req POST /events '{"name":"Mehendi","eventDate":"2027-02-10","venue":"Home"}' "$BRIDE")
check "a day is created" "$c" 201
MEHENDI=$(field /tmp/body id)
c=$(req POST /events '{"name":"Reception","eventDate":"2027-02-12"}' "$BRIDE")
check "and another" "$c" 201
RECEPTION=$(field /tmp/body id)

c=$(req PUT "/events/$MEHENDI" '{"venue":"Taj Krishna","eventDate":"2027-02-11"}' "$BRIDE")
check "a day can be amended — dates move and venues fall through" "$c" 200
assert "and the change took" "$(jqok '.venue == "Taj Krishna"')"

c=$(req GET "/events/$MEHENDI/vendors" "" "$BRIDE")
check "the vendors booked for a day read back" "$c" 200
assert "nobody is booked yet" "$(jqok 'length == 0')"

c=$(req PUT "/events/$RECEPTION" '{"name":"Reception Dinner"}' "$GROOM")
check "another host cannot amend your day" "$c" 403
c=$(req DELETE "/events/$RECEPTION" "" "$BRIDE")
check "a day with nothing booked can be removed" "$c" 200

echo
echo "== 12. Honeymoon: browse by budget and by how long you have =="
c=$(req GET /travel/packages "" "")
check "packages are browsable without signing in" "$c" 200
assert "each carries its destination rather than a bare id" "$(jqok 'length == 0 or (.[0] | has("destinationName"))')"
c=$(req GET "/travel/packages?maxPrice=1&minNights=1" "" "")
check "an impossible budget returns an empty list, not an error" "$c" 200
assert "and it really is empty" "$(jqok 'length == 0')"
c=$(req GET "/travel/packages?maxNights=0" "" "")
check "a nonsensical filter is refused outright" "$c" 400

echo
echo "== 13. Match filters =="
c=$(req GET "/matches/suggestions?city=Hyderabad" "" "$BRIDE")
check "filtering by city works" "$c" 200
c=$(req GET "/matches/suggestions?ageMin=90&ageMax=99" "" "$BRIDE")
check "an age band nobody falls in is empty, not an error" "$c" 200
assert "and it really is empty" "$(jqok '.data | length == 0')"
c=$(req GET "/matches/suggestions?minScore=101" "" "$BRIDE")
check "a score above 100 is refused" "$c" 400
c=$(req GET "/matches/suggestions?sort=recent&addedWithinDays=1" "" "$BRIDE")
check "recently added is a sort, not a separate endpoint" "$c" 200
c=$(req GET "/matches/suggestions?religion=Hindu" "" "$BRIDE")
check "filtering on the biodata works" "$c" 200
c=$(req GET "/matches/suggestions?sort=sideways" "" "$BRIDE")
check "an unknown sort is refused" "$c" 400

c=$(req GET /ai/recommendations/matches "" "$BRIDE")
check "recommendations read" "$c" 200
assert "and nothing below fifty percent is recommended" "$(jqok '[.data[] | select(.score < 50)] | length == 0')"

echo
echo "== 14. A dispute says which money and shows its proof =="
c=$(req POST /verification/cases "{\"subjectType\":\"booking\",\"subjectId\":\"$FAKE_BOOKING\",\"title\":\"No show\",\"description\":\"Nobody arrived on the day and the calls went unanswered.\",\"milestone\":\"advance\",\"evidence\":[\"https://cdn.example.com/receipt.jpg\"]}" "$BRIDE")
check "a dispute against an unknown booking is refused" "$c" 404

c=$(req POST /verification/cases '{"subjectType":"vendor","title":"Listing is not what it claims","description":"The hall in the photographs is not the hall we were shown.","evidence":["https://cdn.example.com/hall.jpg"]}' "$BRIDE")
check "a dispute is raised with evidence attached" "$c" 201
CASE=$(field /tmp/body id)
assert "the evidence is stored" "$(jqok '.evidence | length == 1')"
assert "and it is not yet escalated" "$(jqok '.requiresPhysicalVerification == false')"

c=$(req POST /verification/cases '{"subjectType":"vendor","title":"Bad link","description":"This description is long enough to pass.","evidence":["not-a-url"]}' "$BRIDE")
check "evidence that is not a URL is refused" "$c" 400
c=$(req POST /verification/cases '{"subjectType":"booking","title":"Late","description":"Long enough to pass validation.","milestone":"sideways"}' "$BRIDE")
check "an unknown milestone is refused" "$c" 400

c=$(req PUT "/verification/cases/$CASE/evidence" '{"evidence":["https://cdn.example.com/invoice.pdf"]}' "$BRIDE")
check "more evidence can be added later" "$c" 200
assert "and it is added rather than replacing what was there" "$(jqok '.evidence | length == 2')"

c=$(req PUT "/verification/cases/$CASE/evidence" '{"evidence":["https://cdn.example.com/other.pdf"]}' "$GROOM")
check "somebody else cannot add to your case" "$c" 403

c=$(req PUT "/verification/cases/$CASE/escalate" '{"reason":"short"}' "$ADMIN")
check "escalating without a real reason is refused" "$c" 400
c=$(req PUT "/verification/cases/$CASE/escalate" '{"reason":"The venue address does not appear to exist; somebody has to go and look."}' "$ADMIN")
check "an admin escalates it for a visit" "$c" 200
assert "it is marked as needing somebody on the ground" "$(jqok '.requiresPhysicalVerification == true')"
assert "and the reason is on the record" "$(jqok '[.history[] | select(.status == "escalated")] | length == 1')"

c=$(req PUT "/verification/cases/$CASE/escalate" '{"reason":"Trying to escalate from the outside."}' "$BRIDE")
check "the person who raised it cannot escalate their own case" "$c" 403

echo
echo "== 15. A vendor's world is the marketplace and nothing else =="
c=$(req GET /media/albums "" "$VENDOR")
check "a vendor has no wedding album" "$c" 403
c=$(req GET /matches/suggestions "" "$VENDOR")
check "nor any matchmaking" "$c" 403
c=$(req POST /ai/budget-insight '{"totalBudget":100000}' "$VENDOR")
check "nor the couple's planning assistant" "$c" 403

echo
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
