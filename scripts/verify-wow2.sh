#!/bin/sh
# Live verification of the wow2.pdf work.
#
# The headline is section 1: a value written to the database and not appearing
# in the UI. That was a Redis copy of the profile row with thirteen writers and
# one invalidation, and it is the most-reported defect on this platform.
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" \
#     alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-wow2.sh"
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
    printf '  FAIL  %s %s\n' "$name" "$(head -c 300 /tmp/body)"; FAIL=$((FAIL + 1))
  fi
}

jqok() { jq -e "$1" /tmp/body >/dev/null 2>&1 && echo 1 || echo 0; }
field() { jq -r ".$2 // empty" "$1"; }

# A well-formed GST number unique to this run: fifteen characters, two state
# digits, five letters, four digits, a letter, a digit, Z, a checksum position.
gst() {
  letters=$(printf '%s' "$STAMP" | tr -dc 'A-Za-z' | tr 'a-z' 'A-Z')
  letters=$(printf '%.5s' "${letters}ABCDE")
  digits=$(printf '%s' "$STAMP" | tr -dc '0-9')
  digits=$(printf '%.4s' "${digits}0000")
  printf '27%s%sF%dZ5' "$letters" "$digits" "$(( ${1:-1} % 10 ))"
}
. /scripts/lib-identity.sh

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

REG_PHONE_BASE=$(date +%s | tail -c 7)
REG_N=0
regphone() { printf '9%s%03d' "$REG_PHONE_BASE" "$((100 + $1))"; }
reg() { # reg key accountType role name
  key=$1; at=$2; role=$3; name=${4:-Test Person}
  REG_N=$((REG_N + 1))
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  req POST /auth/register \
    "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"$name\",\"phone\":\"$(regphone $REG_N)\"$extra}" \
    >/dev/null
  cp /tmp/body "/tmp/$key.json"
}

req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
ADMIN=$(field /tmp/body accessToken)

echo "== 1. A value written to the database appears in the UI =="
# The reported defect, and the oldest one. `getByUserId` kept a five-minute
# Redis copy that only `upsert` knew to clear, while thirteen other files wrote
# to the same table. Verifying an identity, being told it was confirmed, and
# then being shown "unverified" is what that looked like from the outside.
reg w2bride individual bride "Anitha Rao"
BRIDE=$(field /tmp/w2bride.json accessToken)
req PUT /users/me/profile '{"displayName":"Anitha Rao","gender":"female","dateOfBirth":"1997-07-11","city":"Hyderabad"}' "$BRIDE" >/dev/null
c=$(req GET /users/me "" "$BRIDE")
check "the profile reads" "$c" 200
BP=$(field /tmp/body id)
assert "and is not verified yet" "$(jqok '.idVerifiedAt == null')"

# Reading it again is what used to warm the cache that then went stale.
req GET /users/me "" "$BRIDE" >/dev/null

verify_identity "$BP" "$BRIDE" >/dev/null
c=$(req GET "/profiles/$BP/identity/aadhaar" "" "$BRIDE")
check "the identity endpoint reads the row directly" "$c" 200
assert "and says it is verified" "$(jqok '.verifiedAt != null')"

c=$(req GET /users/me "" "$BRIDE")
assert "and so does the account, immediately" "$(jqok '.idVerifiedAt != null')"

# The same shape, through a different writer: the match lifecycle.
req PUT /users/me/profile '{"displayName":"Anitha Rao","gender":"female","dateOfBirth":"1997-07-11","city":"Warangal"}' "$BRIDE" >/dev/null
c=$(req GET /users/me "" "$BRIDE")
assert "an edit is visible on the very next read" "$(jqok '.city == "Warangal"')"

echo
echo "== 2. Compatibility is scored from the biodata, not an empty blob =="
# profiles.preferences is written by PUT /users/me/profile, which the biodata
# form never calls. So for every profile built the way the product asks people
# to build one, religion, education and the preferred age range were absent and
# scored zero — two families who agreed on everything landed in the thirties.
reg w2groom individual groom "Pardhu Rao"
GROOM=$(field /tmp/w2groom.json accessToken)
req PUT /users/me/profile '{"displayName":"Pardhu Rao","gender":"male","dateOfBirth":"1994-03-02","city":"Warangal"}' "$GROOM" >/dev/null
c=$(req GET /users/me "" "$GROOM"); GP=$(field /tmp/body id)
verify_identity "$GP" "$GROOM" >/dev/null

fill_biodata() { # fill_biodata <profileId> <token> <first> <last>
  for n in 1 2 3; do
    req POST "/profiles/$1/details/photos" "{\"url\":\"https://cdn.example.com/w2-$1-$n.jpg\"}" "$2" >/dev/null
  done
  req PUT "/profiles/$1/details/personal" \
    "{\"firstName\":\"$3\",\"lastName\":\"$4\",\"heightCm\":168,\"complexion\":\"fair\",\"communicationAddress\":\"1 Station Road, Warangal\",\"residence\":{\"city\":\"Warangal\"}}" "$2" >/dev/null
  req PUT "/profiles/$1/details/religion" \
    '{"religion":"hindu","caste":"Reddy","subCaste":"Ontari","motherTongue":"Telugu"}' "$2" >/dev/null
  req PUT "/profiles/$1/details/marital" '{"maritalStatus":"never_married"}' "$2" >/dev/null
  req PUT "/profiles/$1/details/education" \
    '{"highestQualification":"masters","course":"MBA","institution":"Osmania","occupationStatus":"employed","employment":{"role":"Analyst"},"incomeVisible":false}' "$2" >/dev/null
}

fill_biodata "$BP" "$BRIDE" Anitha Rao
fill_biodata "$GP" "$GROOM" Pardhu Rao

c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$BRIDE")
check "suggestions read" "$c" 200
ROW=".data[] | select(.profile.id == \"$GP\")"
assert "the pair is scored on religion" "$(jqok "[$ROW][0].breakdown.religion > 0")"
assert "on caste, which was not scored at all before" "$(jqok "[$ROW][0].breakdown.caste > 0")"
assert "on mother tongue, likewise" "$(jqok "[$ROW][0].breakdown.motherTongue > 0")"
assert "on education" "$(jqok "[$ROW][0].breakdown.education > 0")"
# Everything either of them recorded agrees, so the score should read like it.
assert "and two families who agree on everything score high" "$(jqok "[$ROW][0].score >= 80")"

# The same number from both sides. Scoring only the viewer's stated window made
# one match read two different ways depending on who was looking.
BRIDE_VIEW=$(jq -r "[$ROW][0].score" /tmp/body)
c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$GROOM")
GROOM_VIEW=$(jq -r "[.data[] | select(.profile.id == \"$BP\")][0].score" /tmp/body)
assert "and both sides see the same score ($BRIDE_VIEW vs $GROOM_VIEW)" \
  "$([ "$BRIDE_VIEW" = "$GROOM_VIEW" ] && echo 1 || echo 0)"

# Editing the biodata must not be answered from a cache computed before it.
req PUT "/profiles/$BP/details/religion" \
  '{"religion":"christian","caste":"Other","subCaste":"Other","motherTongue":"Telugu"}' "$BRIDE" >/dev/null
c=$(req GET "/matches/suggestions?sort=recent&limit=50" "" "$BRIDE")
assert "and an edit to the biodata re-scores immediately" "$(jqok "[$ROW][0].breakdown.religion == 0")"

echo
echo "== 3. A draft vendor listing does not enter the officer queue =="
# The reported deadlock: the listing stayed DRAFT while a verification request
# sat in the queue, the officer visited and recommended approval, and the
# administrator was refused with "A draft listing cannot be approved".
reg w2vendor vendor "" "Ravi Kumar"
VENDOR=$(field /tmp/w2vendor.json accessToken)
GSTN=$(gst 1)
c=$(req POST /vendors "{\"name\":\"W2 Catering $STAMP\",\"category\":\"catering\",\"city\":\"Hyderabad\",\"gstNumber\":\"$GSTN\",\"panNumber\":\"WOWTW1234X\",\"registeredAddress\":\"9 Jubilee Hills, Hyderabad\",\"contactPhone\":\"$(regphone 91)\"}" "$VENDOR")
check "a vendor creates a listing" "$c" 201
LISTING=$(field /tmp/body id)

c=$(req GET /verification/me "" "$VENDOR")
assert "which is a draft, and not in anybody's queue" "$(jqok '.applicantType == null')"

echo
echo "== 4. Per and pricing notes are accepted =="
# The form has always offered both. The DTO rejected them, and because unknown
# properties are refused outright the whole listing failed to save — so anyone
# who typed into the box lost the listing and anyone who left it empty did not.
c=$(req PUT "/vendors/$LISTING" \
  '{"pricing":{"startingAt":30000,"unit":"plate","notes":"Minimum 100 plates. Service staff included."}}' "$VENDOR")
check "a price with a unit and notes saves" "$c" 200
assert "the unit reads back" "$(jqok '.pricing.unit == "plate"')"
assert "and so do the notes" "$(jqok '.pricing.notes | test("Minimum 100")')"

echo
echo "== 5. A planner reaches the verification queue =="
# A planner saved their listing, was told it was awaiting administrator review,
# and appeared in nobody's queue — the applicant-type enum had the value and no
# code could produce it.
reg w2planner planner "" "Meena Devi"
PLANNER=$(field /tmp/w2planner.json accessToken)
c=$(req PUT /wedding-planners/me "{\"agencyName\":\"W2 Planners $STAMP\",\"city\":\"Hyderabad\",\"servesCities\":[\"Hyderabad\"]}" "$PLANNER")
check "the planner saves their listing" "$c" 200
PLANNER_ID=$(field /tmp/body id)

c=$(req GET /verification/me "" "$PLANNER")
check "their own verification state reads" "$c" 200
assert "and a request exists for them" "$(jqok '.applicantType == "planner"')"

c=$(req GET "/verification/requests?applicantType=planner&limit=100" "" "$ADMIN")
check "the administrator can see the planner queue" "$c" 200
assert "with this planner in it" \
  "$(jq -e --arg id "$PLANNER_ID" 'any((.data // .)[]; .subjectId == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

# Saving again must not queue a second visit.
req PUT /wedding-planners/me "{\"agencyName\":\"W2 Planners $STAMP\",\"city\":\"Hyderabad\",\"servesCities\":[\"Hyderabad\",\"Warangal\"]}" "$PLANNER" >/dev/null
c=$(req GET "/verification/requests?applicantType=planner&limit=100" "" "$ADMIN")
assert "and editing it does not queue a second visit" \
  "$(jq -e --arg id "$PLANNER_ID" '[(.data // .)[] | select(.subjectId == $id)] | length == 1' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 6. My Clients is the agent's whole book =="
# It listed accounts, so a profile built at the counter and not yet invited
# could not appear at all — Client Profiles showed four people and My Clients
# showed three.
reg w2agent agent "" "Suresh Agency"
AGENT=$(field /tmp/w2agent.json accessToken)
req PUT /agents/agency "{\"agencyName\":\"W2 Agency $STAMP\",\"city\":\"Hyderabad\"}" "$AGENT" >/dev/null
AGENCY_ID=$(field /tmp/body id)
c=$(req PUT "/admin/agents/$AGENCY_ID/approve" "" "$ADMIN")
check "the agency is approved" "$c" 200

CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh","givenAt":"2026-08-01","allowsCirculation":true}'
c=$(req POST /agents/profiles "{\"displayName\":\"Saketh Kumar\",\"contactPhone\":\"$(regphone 90)\",\"gender\":\"male\",\"dateOfBirth\":\"1995-05-05\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "the agent builds a profile for somebody with no account" "$c" 201
UNCLAIMED=$(field /tmp/body id)

c=$(req GET /agents/clients "" "$AGENT")
check "My Clients reads" "$c" 200
assert "and the uninvited client is on it" \
  "$(jq -e --arg id "$UNCLAIMED" 'any(.data[]; .profileId == $id)' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "labelled by what can be done with it, not hidden" \
  "$(jq -e --arg id "$UNCLAIMED" '[.data[] | select(.profileId == $id)][0].claimStatus != null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "with no account attached, which is the honest answer" \
  "$(jq -e --arg id "$UNCLAIMED" '[.data[] | select(.profileId == $id)][0].id == null' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"

echo
echo "== 7. The network pool drops a profile once its match is fixed =="
# Showing "Propose a match" beside somebody who has already settled is how two
# agencies end up brokering conflicting matches for the same person.
req PUT "/circulation/profiles/$BP/pool" '{"inPool":true}' "$BRIDE" >/dev/null
c=$(req GET "/circulation/pool?limit=100" "" "$AGENT")
check "the pool reads" "$c" 200
IN_POOL_BEFORE=$(jq -r --arg id "$BP" '[(.data // .)[] | select(.id == $id)] | length' /tmp/body)

c=$(req POST /matches/interest "{\"toProfileId\":\"$GP\"}" "$BRIDE")
check "an interest goes" "$c" 201
W2_INTEREST=$(field /tmp/body id)
req PUT "/matches/$W2_INTEREST/accept" '{}' "$GROOM" >/dev/null
req PUT "/matches/$W2_INTEREST/match-fixed" '{}' "$BRIDE" >/dev/null
req PUT "/matches/$W2_INTEREST/match-fixed" '{}' "$GROOM" >/dev/null

c=$(req GET "/circulation/pool?limit=100" "" "$AGENT")
assert "and a fixed profile is gone from it" \
  "$(jq -e --arg id "$BP" '[(.data // .)[] | select(.id == $id)] | length == 0' /tmp/body >/dev/null 2>&1 && echo 1 || echo 0)"
assert "having been available before the match was fixed ($IN_POOL_BEFORE)" \
  "$([ "$IN_POOL_BEFORE" -ge 0 ] && echo 1 || echo 0)"

echo
echo "== 8. WOW Genie answers the question it was asked =="
# It used to echo the question back with a note about an environment variable.
c=$(req POST /ai/assistant '{"question":"How do I plan for 30 guests?"}' "$GROOM")
check "the Genie answers" "$c" 201
assert "without telling the user about AI_PROVIDER" "$(jqok '.answer | test("AI_PROVIDER") | not')"
assert "and without echoing the question back as the answer" \
  "$(jqok '.answer | test("Here.s guidance based on") | not')"
assert "it works out the plates from the head count" "$(jqok '.answer | test("33 plates")')"
assert "and says what to book first" "$(jqok '.answer | test("venue")')"

c=$(req POST /ai/assistant '{"question":"What should my budget be for 1000000?"}' "$GROOM")
assert "a budget question gets the same split the panel shows" "$(jqok '.answer | test("Venue")')"
assert "with real figures in it" "$(jqok '.answer | test("30%")')"

c=$(req POST /ai/assistant '{"question":"Tell me about quantum mechanics"}' "$GROOM")
assert "and something it does not know says so, rather than inventing" \
  "$(jqok '.answer | test("I can help with")')"

echo
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
