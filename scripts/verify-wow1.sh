#!/bin/sh
# Live verification of the wow_1.pdf work: the match card and everything it
# needs to be worth reading, search and sort and shortlist, the identity gate
# on matchmaking, the chat header's context, the biodata money fields, and the
# upload path that "is not taking all types of images".
#
# Runs from inside the compose network, same as the other suites:
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" \
#     alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-wow1.sh"
#
# Needs MAIL_PROVIDER=log and AADHAAR_PROVIDER=mock.
API=${API:-http://backend:3000/api}
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
    printf '  FAIL  %s %s\n' "$name" "$(head -c 300 /tmp/body)"; FAIL=$((FAIL + 1))
  fi
}

jqok() { jq -e "$1" /tmp/body >/dev/null 2>&1 && echo 1 || echo 0; }
field() { jq -r ".$2 // empty" "$1"; }
. /scripts/lib-identity.sh

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

REG_PHONE_BASE=$(date +%s | tail -c 7)
REG_N=0
regphone() { printf '9%s%03d' "$REG_PHONE_BASE" "$((800 + $1))"; }
reg() { # reg key role name
  key=$1; role=$2; name=${3:-Test Person}
  REG_N=$((REG_N + 1))
  req POST /auth/register \
    "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"$role\",\"displayName\":\"$name\",\"phone\":\"$(regphone $REG_N)\"}" \
    >/dev/null
  cp /tmp/body "/tmp/$key.json"
}

PREFS='{"religion":"hindu","education":"masters","lifestyle":["vegetarian"]}'

echo "== 1. Personas =="
reg w1bride bride "Anitha Reddy"
reg w1groom groom "Pardhu Rao"
reg w1other groom "Pardhu Varma"
BRIDE=$(field /tmp/w1bride.json accessToken)
GROOM=$(field /tmp/w1groom.json accessToken)
OTHER=$(field /tmp/w1other.json accessToken)
assert "three accounts exist" "$([ -n "$BRIDE" ] && [ -n "$GROOM" ] && [ -n "$OTHER" ] && echo 1 || echo 0)"

req PUT /users/me/profile "{\"displayName\":\"Anitha Reddy\",\"gender\":\"female\",\"dateOfBirth\":\"1997-07-11\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$BRIDE" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Pardhu Rao\",\"gender\":\"male\",\"dateOfBirth\":\"1994-03-02\",\"city\":\"Hyderabad\",\"preferences\":$PREFS}" "$GROOM" >/dev/null
req PUT /users/me/profile "{\"displayName\":\"Pardhu Varma\",\"gender\":\"male\",\"dateOfBirth\":\"1992-01-09\",\"city\":\"Warangal\",\"preferences\":$PREFS}" "$OTHER" >/dev/null

c=$(req GET /users/me "" "$BRIDE"); BP=$(field /tmp/body id); BRIDE_CODE=$(field /tmp/body profileCode)
c=$(req GET /users/me "" "$GROOM"); GP=$(field /tmp/body id); GROOM_CODE=$(field /tmp/body profileCode)
c=$(req GET /users/me "" "$OTHER"); OP=$(field /tmp/body id); OTHER_CODE=$(field /tmp/body profileCode)

echo
echo "== 2. The profile code, and what the account no longer hands out =="
c=$(req GET /users/me "" "$BRIDE")
check "the profile reads" "$c" 200
assert "every profile has a code" "$(jqok '.profileCode | test("^WOW[0-9]+$")')"
# The peppered fingerprint of an identity document has no business in a
# browser. It went out with every session bootstrap before this.
assert "and the identity-document fingerprint is not in it" "$(jqok 'has("governmentIdHash") | not')"
assert "nor is the officer who confirmed it" "$(jqok 'has("idVerifiedByUserId") | not')"
assert "the last four digits still are, which is what a person recognises" "$(jqok 'has("governmentIdLast4")')"
assert "and when they were last seen, for the Recently Active sort" "$(jqok 'has("lastActiveAt")')"
assert "two profiles do not share a code" "$([ "$BRIDE_CODE" != "$GROOM_CODE" ] && echo 1 || echo 0)"

echo
echo "== 3. Uploads: the filename, not the file type =="
# "It is not taking all types of images" was a filename rule, not an image
# rule. Every one of these is an ordinary photograph off an ordinary device.
for f in "photo.jpg" "WhatsApp Image 2026-08-26 at 5.28.11 PM.jpeg" "IMG_20260826.jfif" \
         "snap.avif" "pic (1).png" "holiday.bmp" "chart.HEIC" "clip.mov"; do
  c=$(req POST /media/profile-photo/presign "$(jq -nc --arg f "$f" '{filename:$f}')" "$BRIDE")
  check "presign accepts $f" "$c" 201
done
assert "and the key it builds has no spaces or brackets in it" \
  "$(jqok '.key | test("^uploads/[^ ()]+$")')"

c=$(req POST /media/profile-photo/presign '{"filename":"../escape.jpg"}' "$BRIDE")
check "a path segment is still refused" "$c" 400
c=$(req POST /media/profile-photo/presign '{"filename":"notes.txt"}' "$BRIDE")
check "and so is something that is not an image" "$c" 400
assert "with a message naming what is accepted" "$(jqok '.error.message[0] | test("JPEG")')"

echo
echo "== 4. Every failure carries a reason, at the level a client reads =="
# The client read `message` at the top and the envelope puts it under `error`,
# so every explanation the server produced was replaced by a generic sentence.
c=$(req POST /media/profile-photo/presign '{"filename":"notes.txt"}' "$BRIDE")
assert "the envelope carries the reason under error.message" "$(jqok '.error.message != null')"
assert "and a validation failure is a list, one entry per broken rule" "$(jqok '.error.message | type == "array"')"

echo
echo "== 5. Identity gates the three committing actions, and nothing else =="
c=$(req GET "/matches/suggestions" "" "$BRIDE")
check "browsing is open to an unverified profile" "$c" 200
c=$(req GET /matches/status "" "$BRIDE")
check "and the status says why the buttons will be off" "$c" 200
assert "reporting the document as not submitted" "$(jqok '.identitySubmitted == false')"
assert "and not verified" "$(jqok '.identityVerified == false')"

c=$(req POST /matches/interest "{\"toProfileId\":\"$GP\"}" "$BRIDE")
check "sending an interest is refused" "$c" 403
assert "and says what is missing" "$(jqok '.error.message | test("[Ii]dentity verification")')"

verify_identity "$BP" "$BRIDE" >/dev/null
c=$(req GET /matches/status "" "$BRIDE")
assert "once confirmed the status says so" "$(jqok '.identityVerified == true')"
c=$(req POST /matches/interest "{\"toProfileId\":\"$GP\"}" "$BRIDE")
check "and the interest goes" "$c" 201
INTEREST=$(field /tmp/body id)

# The receiving side is gated too, and declining is deliberately not — a person
# may always say no.
c=$(req PUT "/matches/$INTEREST/accept" '{}' "$GROOM")
check "an unverified profile cannot accept" "$c" 403
verify_identity "$GP" "$GROOM" >/dev/null
c=$(req PUT "/matches/$INTEREST/accept" '{}' "$GROOM")
check "and can once the document is confirmed" "$c" 200

echo
echo "== 6. A card with enough on it to judge =="
verify_identity "$OP" "$OTHER" >/dev/null
# The personal section will not save until three photographs are on the
# profile, so nothing else in the biodata can be filled in without them —
# which is the whole of the six-report biodata cluster from the last round.
for n in 1 2 3; do
  req POST "/profiles/$OP/details/photos" "{\"url\":\"https://cdn.example.com/w1-$OP-$n.jpg\"}" "$OTHER" >/dev/null
done
c=$(req PUT "/profiles/$OP/details/personal" \
  '{"firstName":"Pardhu","lastName":"Varma","heightCm":175,"complexion":"fair","communicationAddress":"1 Station Road, Warangal","residence":{"city":"Warangal"}}' "$OTHER")
check "the personal section saves" "$c" 200
c=$(req PUT "/profiles/$OP/details/religion" \
  '{"religion":"hindu","caste":"Reddy","subCaste":"Ontari","motherTongue":"Telugu"}' "$OTHER")
check "and so does religion and community" "$c" 200
req PUT "/profiles/$OP/details/marital" '{"maritalStatus":"never_married"}' "$OTHER" >/dev/null
req PUT "/profiles/$OP/details/education" \
  '{"highestQualification":"masters","course":"MBA","institution":"Osmania","occupationStatus":"employed","employment":{"role":"Data Analyst"},"incomeVisible":false}' "$OTHER" >/dev/null

c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$BRIDE")
check "suggestions read" "$c" 200
ROW=".data[] | select(.profile.id == \"$OP\")"
assert "the card names a profile code" "$(jqok "[$ROW] | length == 1 and (.[0].profile.profileCode | test(\"^WOW\"))")"
assert "says whether an officer has met them" "$(jqok "[$ROW][0].profile.verified == true")"
assert "carries their height" "$(jqok "[$ROW][0].profile.card.heightCm == 175")"
assert "what they studied" "$(jqok "[$ROW][0].profile.card.highestQualification == \"masters\"")"
assert "what they do" "$(jqok "[$ROW][0].profile.card.profession == \"Data Analyst\"")"
assert "whether they have been married before" "$(jqok "[$ROW][0].profile.card.maritalStatus == \"never_married\"")"
assert "their community" "$(jqok "[$ROW][0].profile.card.caste == \"Reddy\"")"
assert "a score with the dimensions it came from" "$(jqok "[$ROW][0] | .score >= 0 and (.breakdown | type == \"object\")")"
assert "and where the two of you already stand" "$(jqok "[$ROW][0].interaction == \"none\"")"

# The one already approached says so, rather than offering the button again.
assert "somebody already matched reads as matched" \
  "$(jqok "[.data[] | select(.profile.id == \"$GP\")] | length == 0 or .[0].interaction == \"accepted\"")"

echo
echo "== 7. Search, by whichever thing you remember =="
c=$(req GET "/matches/suggestions?sort=recent&q=$OTHER_CODE" "" "$BRIDE")
check "searching by profile code reads" "$c" 200
assert "and finds exactly that profile" "$(jqok "(.data | length) == 1 and .data[0].profile.id == \"$OP\"")"

c=$(req GET "/matches/suggestions?sort=recent&q=Varma" "" "$BRIDE")
assert "searching by name finds them too" "$(jqok "[.data[] | select(.profile.id == \"$OP\")] | length == 1")"

c=$(req GET "/matches/suggestions?sort=recent&q=Warangal" "" "$BRIDE")
assert "and so does the town they live in" "$(jqok "[.data[] | select(.profile.id == \"$OP\")] | length == 1")"

c=$(req GET "/matches/suggestions?sort=recent&q=nobodyatallnamedthis" "" "$BRIDE")
assert "a search matching nobody returns nobody, not everybody" "$(jqok '(.data | length) == 0')"

c=$(req GET "/matches/suggestions?sort=recent&profession=Data%20Analyst" "" "$BRIDE")
assert "filtering by profession works off the biodata" "$(jqok "[.data[] | select(.profile.id == \"$OP\")] | length == 1")"

echo
echo "== 8. Sorting =="
for order in score recent active age ageDesc; do
  c=$(req GET "/matches/suggestions?sort=$order" "" "$BRIDE")
  check "sort=$order is accepted" "$c" 200
done
c=$(req GET "/matches/suggestions?sort=sideways" "" "$BRIDE")
check "an invented order is refused rather than ignored" "$c" 400

c=$(req GET "/matches/suggestions?sort=age&limit=50" "" "$BRIDE")
assert "ascending age really is ascending" \
  "$(jq -e '[.data[].profile.ageRange | select(. != null) | split("-")[0] | tonumber] | . == sort' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 9. Pagination, so a long list is not one long page =="
c=$(req GET "/matches/suggestions?sort=recent&limit=1" "" "$BRIDE")
check "a page reads" "$c" 200
assert "one row at a time" "$(jqok '(.data | length) <= 1')"
assert "with a total to count down from" "$(jqok '.meta.total >= 1')"

echo
echo "== 10. Shortlist: private, idempotent, and its own list =="
c=$(req GET /matches/shortlist "" "$BRIDE")
check "the shortlist reads, empty" "$c" 200
assert "with nothing on it" "$(jqok 'length == 0')"

c=$(req PUT "/matches/shortlist/$OP" '{"note":"Same town as my sister"}' "$BRIDE")
check "a profile is kept" "$c" 200
c=$(req PUT "/matches/shortlist/$OP" '{}' "$BRIDE")
check "keeping it twice is the same intent, not an error" "$c" 200

c=$(req GET /matches/shortlist "" "$BRIDE")
assert "it appears once" "$(jqok 'length == 1')"
assert "with the note that was written on it" "$(jqok '.[0].note == "Same town as my sister"')"
assert "and the same card facts as a suggestion" "$(jqok '.[0].profile.card.profession == "Data Analyst"')"

c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$BRIDE")
assert "the suggestion says it is shortlisted" "$(jqok "[$ROW][0].shortlisted == true")"
c=$(req GET "/matches/suggestions?sort=recent&shortlistedOnly=true" "" "$BRIDE")
assert "and the list can be narrowed to just those" "$(jqok '[.data[] | select(.shortlisted != true)] | length == 0')"

# Nobody is told they are on somebody's shortlist.
c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$OTHER")
assert "the other side is never told about it" "$(jqok "[.data[] | select(.profile.id == \"$BP\")] | length == 0 or .[0].shortlisted != true")"

c=$(req PUT "/matches/shortlist/$BP" '{}' "$BRIDE")
check "you cannot shortlist yourself" "$c" 400
c=$(req DELETE "/matches/shortlist/$OP" "" "$BRIDE")
check "and it can be taken off again" "$c" 200
c=$(req GET /matches/shortlist "" "$BRIDE")
assert "leaving nothing behind" "$(jqok 'length == 0')"

echo
echo "== 11. Confirmed matches say whose, by whom, and when =="
c=$(req GET /matches/accepted "" "$BRIDE")
check "accepted matches read" "$c" 200
assert "there is one" "$(jqok 'length == 1')"
assert "carrying a score rather than a bare name" "$(jqok '.[0].score >= 0')"
assert "and the state of the fixing" "$(jqok '.[0].matchFixedState == "none"')"
assert "with neither side confirmed yet" "$(jqok '.[0].confirmedByYouAt == null and .[0].confirmedByThemAt == null')"
assert "and no fixed date to show" "$(jqok '.[0].fixedAt == null')"

c=$(req PUT "/matches/$INTEREST/match-fixed" '{}' "$BRIDE")
check "the bride confirms her side" "$c" 200
c=$(req GET /matches/accepted "" "$BRIDE")
assert "which is recorded against her, not against them" \
  "$(jqok '.[0].confirmedByYouAt != null and .[0].confirmedByThemAt == null')"
assert "and it is not fixed on one confirmation" "$(jqok '.[0].fixedAt == null')"

c=$(req PUT "/matches/$INTEREST/match-fixed" '{}' "$GROOM")
check "the groom confirms his" "$c" 200
c=$(req GET /matches/accepted "" "$BRIDE")
assert "now both sides show" "$(jqok '.[0].confirmedByYouAt != null and .[0].confirmedByThemAt != null')"
assert "the match is fixed" "$(jqok '.[0].matchFixedState == "confirmed"')"
assert "and it has a date, which is the later of the two" "$(jqok '.[0].fixedAt != null')"

echo
echo "== 12. Chat says who this is and why you are talking =="
GROOM_USER=$(field /tmp/w1groom.json user.id)
c=$(req POST /chat/messages "{\"toUserId\":\"$GROOM_USER\",\"body\":\"Namaste.\"}" "$BRIDE")
check "a message goes" "$c" 201
c=$(req GET /chat/conversations "" "$BRIDE")
check "the conversation list reads" "$c" 200
assert "the row names a profile code, so two Pardhus are distinguishable" \
  "$(jqok '[.[] | select(.profileCode != null)] | length >= 1')"
assert "with an age band" "$(jqok '[.[] | select(.ageRange != null)] | length >= 1')"
assert "and the town" "$(jqok '[.[] | select(.city != null)] | length >= 1')"
assert "and a profile to open from the header" "$(jqok '[.[] | select(.profileId != null)] | length >= 1')"
assert "the context says why the two are connected" \
  "$(jqok '[.[] | select(.context != null and .context.standing == "fixed")] | length == 1')"
assert "with the score on it" "$(jqok '[.[] | select(.context.score != null)] | length == 1')"
assert "and the message has not been read yet" "$(jqok '[.[] | select(.lastMessageRead == true)] | length == 0')"

BRIDE_USER=$(field /tmp/w1bride.json user.id)
req PUT "/chat/messages/read?withUserId=$BRIDE_USER" '{}' "$GROOM" >/dev/null
c=$(req GET /chat/conversations "" "$BRIDE")
assert "once they open it, the second tick appears" \
  "$(jqok '[.[] | select(.lastMessageRead == true)] | length == 1')"

echo
echo "== 13. Biodata: the money fields that were saved and never shown =="
c=$(req PUT "/profiles/$OP/details/family" \
  '{"father":{"name":"Ramesh"},"mother":{"name":"Sita"},"familyType":"nuclear","familyStatus":"middle_class","nativePlace":"Warangal","brothers":1,"sisters":0,"familyNetWorth":7500000,"familyNetWorthVisible":true}' "$OTHER")
check "family details save with a net worth" "$c" 200
c=$(req GET "/profiles/$OP/details" "" "$OTHER")
assert "and it reads back" "$(jqok '(.details.familyNetWorth | tonumber) == 7500000')"
assert "with the family's decision about showing it" "$(jqok '.details.familyNetWorthVisible == true')"

c=$(req POST "/profiles/$OP/details/assets" \
  '{"type":"independent_house","location":"Warangal","area":"2400 sq yd","estimatedValue":4500000,"visible":true}' "$OTHER")
check "an asset saves with an estimated value" "$c" 201
c=$(req GET "/profiles/$OP/details" "" "$OTHER")
assert "which survives the round trip" \
  "$(jqok '[.assets[] | select((.estimatedValue | tonumber) == 4500000)] | length == 1')"
assert "along with the area it sits on" "$(jqok '[.assets[] | select(.area == "2400 sq yd")] | length == 1')"

c=$(req PUT "/profiles/$OP/details/family" \
  '{"father":{"name":"Ramesh"},"mother":{"name":"Sita"},"familyType":"nuclear","familyStatus":"middle_class","brothers":1,"sisters":0}' "$OTHER")
check "saving the section again without the figure is allowed" "$c" 200
c=$(req GET "/profiles/$OP/details" "" "$OTHER")
# Omitting a field means "not mentioned", not "set it to nothing" — the same
# rule the rest of this form follows.
assert "and does not wipe the net worth already entered" "$(jqok '(.details.familyNetWorth | tonumber) == 7500000')"

echo
echo "== 14. Matchmaking closes on a fixed match, as before =="
c=$(req GET /matches/suggestions "" "$BRIDE")
check "a fixed profile is out of matchmaking" "$c" 403

echo
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
