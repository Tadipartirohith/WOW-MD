#!/bin/sh
# Live verification of the backlog close-out: SMS as a real channel, phone
# verification, phone-only invitations, MFA recovery codes, profile claim
# requests, data export and erasure, the network-pool quota, circulation reach,
# and profile-photo uploads.
#
#   docker run --rm --network docker_default -v "$PWD/scripts:/scripts" \
#     alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-phase3.sh"
#
# Needs MAIL_PROVIDER=log and SMS_PROVIDER=log: in those modes invitation links
# and verification codes come back on the response, because nothing is actually
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


PHONE_BASE=$(date +%s | tail -c 7)
phone() { echo "+919${PHONE_BASE}$1"; }
REG_PHONE_BASE=$(date +%s | tail -c 7)
regphone() { printf '9%s%03d' "$REG_PHONE_BASE" "$((500 + $1))"; }
REG_N=0
reg() {
  key=$1; at=$2; role=$3
  extra=""
  [ -n "$role" ] && extra=",\"role\":\"$role\""
  REG_N=$((REG_N + 1))
  name="Test $(echo "$key" | tr -d '0-9')"
  c=$(req POST /auth/register "{\"email\":\"$key-$STAMP@t.com\",\"password\":\"Password123\",\"accountType\":\"$at\",\"displayName\":\"$name\",\"phone\":\"$(regphone $REG_N)\"$extra}")
  cp /tmp/body "/tmp/$key.json"
  check "register $key" "$c" 201
}

CONSENT='"consent":{"method":"in_person","givenByRelation":"father","givenByName":"Ramesh Sharma","givenAt":"2026-08-01","allowsCirculation":true}'

if command -v redis-cli >/dev/null 2>&1; then
  KEYS=$(redis-cli -h "${REDIS_HOST:-redis}" --scan --pattern 'throttle:*' 2>/dev/null)
  [ -n "$KEYS" ] && echo "$KEYS" | xargs -r redis-cli -h "${REDIS_HOST:-redis}" DEL >/dev/null 2>&1
  echo "-- cleared rate-limit counters so this run starts clean --"
fi

echo
echo "== 1. Personas =="
reg agent agent
reg solo individual bride
AGENT=$(field /tmp/agent.json accessToken)
SOLO=$(field /tmp/solo.json accessToken)
SOLO_EMAIL="solo-$STAMP@t.com"

c=$(req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
check "admin signs in" "$c" 200
ADMIN=$(field /tmp/body accessToken)

# Getting the agency approved, which is the precondition for everything an
# agent does. The route is exercised properly in verify-phase1; here it is
# setup, so it is done in as few steps as possible.
req PUT /agents/agency "{\"agencyName\":\"Backlog Agency\",\"city\":\"Hyderabad\",\"contactPhone\":\"$(phone 900)\"}" "$AGENT" >/dev/null

c=$(req POST /verification/officers "{\"email\":\"officer-$STAMP@wow.local\",\"name\":\"Field Officer\",\"region\":\"Hyderabad\"}" "$ADMIN")
check "admin creates a verification officer" "$c" 201
OFFICER_ID=$(field /tmp/body id)
OFFICER_TEMP=$(field /tmp/body devPassword)

c=$(req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"$OFFICER_TEMP\"}")
OFFICER=$(field /tmp/body accessToken)
req POST /auth/password/change "{\"currentPassword\":\"$OFFICER_TEMP\",\"newPassword\":\"OfficerPass1\"}" "$OFFICER" >/dev/null
c=$(req POST /auth/login "{\"email\":\"officer-$STAMP@wow.local\",\"password\":\"OfficerPass1\"}")
OFFICER=$(field /tmp/body accessToken)

c=$(req GET /verification/requests "" "$ADMIN")
VR=$(jq -r --arg me "$(jq -r '.user.id' /tmp/agent.json)" '[.data[] | select(.applicantUserId == $me)] | .[0].id // empty' /tmp/body)
req PUT "/verification/requests/$VR/allocate" "{\"officerUserId\":\"$OFFICER_ID\"}" "$ADMIN" >/dev/null
req PUT "/verification/requests/$VR/start" '' "$OFFICER" >/dev/null
req PUT "/verification/requests/$VR/findings" '{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}' "$OFFICER" >/dev/null
c=$(req PUT "/verification/requests/$VR/decide" '{"status":"approved"}' "$OFFICER")
check "the agency is approved by an officer, not by an admin" "$c" 200

echo
echo "== 2. Phone verification =="
c=$(req POST /auth/phone/send-code '' "$SOLO")
check "a code is sent to the number on the account" "$c" 201
CODE=$(field /tmp/body devCode)
assert "and it expires" "$(jqok '.expiresAt != null')"

c=$(req POST /auth/phone/verify '{"code":"000000"}' "$SOLO")
check "a wrong code is refused" "$c" 400
c=$(req POST /auth/phone/verify '{"code":"12345"}' "$SOLO")
check "a malformed code is refused before it is checked" "$c" 400
c=$(req POST /auth/phone/verify "{\"code\":\"$CODE\"}" "$SOLO")
check "the right code verifies the number" "$c" 200

c=$(req POST /auth/phone/send-code '' "$SOLO")
check "an already-verified number is not re-sent to" "$c" 400

echo
echo "== 3. A profile with a number and no email can still be handed over =="
c=$(req POST /agents/profiles "{\"displayName\":\"Phone Only\",\"contactPhone\":\"$(phone 100)\",\"gender\":\"female\",\"dateOfBirth\":\"1996-02-02\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "a phone-only profile is created" "$c" 201
PHONLY=$(field /tmp/body id)
assert "with no email on file" "$(jqok '.contactEmail == null')"

c=$(req POST "/agents/profiles/$PHONLY/invite" '' "$AGENT")
check "and it can be invited — by SMS alone" "$c" 201
assert "the invitation went out over SMS" "$(jqok '[.channels[] | select(. == "sms")] | length == 1')"
assert "and not over email, because there is none" "$(jqok '[.channels[] | select(. == "email")] | length == 0')"
TOKEN=$(field /tmp/body devToken)

c=$(req POST /auth/invitations/accept "{\"token\":\"$TOKEN\",\"password\":\"Claimed123\"}")
check "claiming without an email address is refused" "$c" 400
c=$(req POST /auth/invitations/accept "{\"token\":\"$TOKEN\",\"password\":\"Claimed123\",\"email\":\"claimed-$STAMP@t.com\"}")
check "and accepted once they supply one" "$c" 201
CLAIMED=$(field /tmp/body accessToken)
assert "the account is not email-verified — an SMS link proves nothing about an address" "$(jqok '.user.isVerified == false')"

c=$(req GET /users/me "" "$CLAIMED")
assert "the profile now carries the address they gave" "$(jq -e --arg e "claimed-$STAMP@t.com" '.contactEmail == $e' /tmp/body >/dev/null && echo 1 || echo 0)"

echo
echo "== 4. Claim requests: the subject signed up before the agent could invite them =="
# The order matters, and it is the order this actually happens in: the agent
# takes the family's details at the office and builds the profile, and the son
# signs up himself that evening. Building it the other way round is refused at
# intake, which is why the stranding only ever appears like this.
LATER_EMAIL="later-$STAMP@t.com"
c=$(req POST /agents/profiles "{\"displayName\":\"Signed Up Later\",\"contactEmail\":\"$LATER_EMAIL\",\"contactPhone\":\"$(phone 101)\",\"gender\":\"male\",\"dateOfBirth\":\"1993-03-03\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "an agent builds a profile from details taken at the office" "$c" 201
STRANDED=$(field /tmp/body id)

REG_N=$((REG_N + 1))
c=$(req POST /auth/register "{\"email\":\"$LATER_EMAIL\",\"password\":\"Password123\",\"accountType\":\"individual\",\"role\":\"groom\",\"displayName\":\"Signed Up Later\",\"phone\":\"$(regphone $REG_N)\"}")
check "that evening, the subject signs up on their own" "$c" 201
cp /tmp/body /tmp/later.json
LATER=$(field /tmp/later.json accessToken)

c=$(req POST "/agents/profiles/$STRANDED/invite" '' "$AGENT")
check "the invitation is now refused as a duplicate — the work is stranded" "$c" 409

c=$(req POST "/agents/profiles/$STRANDED/claim-request" '{"message":"We met at the Kukatpally office in March."}' "$AGENT")
check "so the agent asks them to take it instead" "$c" 201
CLAIM=$(field /tmp/body id)

c=$(req POST "/agents/profiles/$STRANDED/claim-request" '{}' "$AGENT")
check "and cannot ask twice" "$c" 409

c=$(req GET /profile-claims "" "$LATER")
check "the subject sees it waiting on them" "$c" 200
assert "with the agency's note attached" "$(jqok '.[0].message != null')"
assert "and enough of the profile to recognise it" "$(jqok '.[0].profile.displayName != null')"

c=$(req PUT "/profile-claims/$CLAIM/approve" '' "$CLAIMED")
check "somebody else cannot answer it" "$c" 403

c=$(req PUT "/profile-claims/$CLAIM/approve" '' "$LATER")
check "the subject accepts, and the profile becomes theirs" "$c" 200
PROFILE_HANDED=$(field /tmp/body profileId)
assert "and it is the profile the agent built" "$([ "$PROFILE_HANDED" = "$STRANDED" ] && echo 1 || echo 0)"

c=$(req GET /users/me "" "$LATER")
assert "reading their own profile now returns the agent's work, not an empty one" "$(jqok '.displayName == "Signed Up Later"')"

c=$(req PUT "/profile-claims/$CLAIM/approve" '' "$LATER")
check "and it cannot be answered twice" "$c" 400

c=$(req PUT "/agents/profiles/$STRANDED" '{"city":"Chennai"}' "$AGENT")
check "the agency's write access ends the moment it is claimed" "$c" 403

echo
echo "== 5. MFA recovery codes =="
c=$(req POST /auth/mfa/setup '' "$SOLO")
check "two-factor setup starts" "$c" 201
assert "and hands back a secret to scan" "$(jqok '.otpauthUrl != null')"

c=$(req GET /auth/mfa/recovery-codes "" "$SOLO")
check "nothing is issued before setup completes" "$c" 200
assert "so there are none yet" "$(jqok '.remaining == 0')"

c=$(req POST /auth/mfa/recovery-codes '{"password":"Password123"}' "$SOLO")
check "and none can be regenerated either" "$c" 400

echo
echo "== 6. Data export and erasure =="
c=$(req GET /users/me/export "" "$SOLO")
check "a person can export everything held about them" "$c" 200
assert "the account is in it" "$(jqok '.account.email != null')"
assert "so is the consent record — the evidence of what was agreed" "$(jqok 'has("consents")')"
assert "and the bookings" "$(jqok 'has("bookings")')"
assert "but never the password hash" "$(grep -qv passwordHash /tmp/body && echo 1 || echo 0)"

c=$(req POST /users/me/erase '{"password":"WrongPassword1"}' "$SOLO")
check "erasure needs the right password" "$c" 400

echo
echo "== 7. The network pool has a ceiling =="
c=$(req POST /agents/profiles "{\"displayName\":\"Pool Candidate\",\"contactPhone\":\"$(phone 102)\",\"gender\":\"female\",\"dateOfBirth\":\"1997-05-05\",\"city\":\"Hyderabad\",$CONSENT}" "$AGENT")
check "a profile is built for the pool" "$c" 201
POOLED=$(field /tmp/body id)
c=$(req GET /circulation/agents "" "$AGENT")
check "the agent directory reads" "$c" 200

# Entering the pool is circulation, so it carries the same completeness gate as
# sending a biodata to one family — the pool is every approved agency at once.
c=$(req PUT "/circulation/profiles/$POOLED/pool" '{"visibility":"pool"}' "$AGENT")
check "an incomplete biodata cannot enter the pool either" "$c" 400

seed_photos "$POOLED" "$AGENT"
req PUT "/profiles/$POOLED/details/personal" '{"firstName":"Priya","lastName":"Sharma","heightCm":163,"complexion":"Fair","communicationAddress":"12 Jubilee Hills"}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/religion" '{"religion":"Hindu","caste":"Kamma","subCaste":"None","motherTongue":"Telugu"}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/horoscope" '{"horoscopeAvailable":false}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/marital" '{"maritalStatus":"never_married"}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/family" '{"father":{"name":"Ramesh Sharma"},"mother":{"name":"Lakshmi Sharma"},"familyType":"nuclear","familyStatus":"Middle class","brothers":1,"sisters":0}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/education" '{"highestQualification":"B.Tech","course":"IT","occupationStatus":"employed","employment":{"company":"TCS","designation":"Engineer"}}' "$AGENT" >/dev/null
req PUT "/profiles/$POOLED/details/preferences" '{"preferredAgeMin":26,"preferredAgeMax":34,"preferredHeightMinCm":165,"preferredHeightMaxCm":190}' "$AGENT" >/dev/null

c=$(req PUT "/circulation/profiles/$POOLED/pool" '{"visibility":"pool"}' "$AGENT")
check "a complete, consented profile enters the pool" "$c" 200
c=$(req PUT "/circulation/profiles/$POOLED/pool" '{"visibility":"pool"}' "$AGENT")
check "re-pooling the same profile is not a second entry" "$c" 200

echo
echo "== 8. Did circulation lead anywhere? =="
c=$(req GET "/circulation/profiles/$POOLED/reach" "" "$AGENT")
check "reach reads for a profile you manage" "$c" 200
assert "shares are counted" "$(jqok 'has("shared")')"
assert "so are opens" "$(jqok 'has("opened")')"
assert "and what came of them" "$(jqok 'has("accepted")')"
assert "opened-but-silent is reported, because that is the number worth acting on" "$(jqok 'has("openedButSilent")')"

c=$(req GET "/circulation/profiles/$POOLED/reach" "" "$SOLO")
check "and not for a profile that is not yours" "$c" 403

echo
echo "== 9. Profile photographs upload rather than being pasted in =="
c=$(req POST /media/profile-photo/presign '{"filename":"priya.jpg"}' "$AGENT")
check "an agent can get an upload slot" "$c" 201
assert "which carries somewhere to PUT the file" "$(jqok '.uploadUrl != null')"
assert "and the URL the photo will live at" "$(jqok '.publicUrl != null')"

c=$(req POST /media/profile-photo/presign '{"filename":"../../etc/passwd"}' "$AGENT")
check "path traversal in the filename is refused" "$c" 400

# An agent legitimately holds MEDIA_MANAGE_OWN — they run albums for clients.
# The presign route above exists because it needs a *different* permission, so
# that an individual managing only their own profile can use it too.
c=$(req POST /media/profile-photo/presign '{"filename":"self.jpg"}' "$SOLO")
check "and so can somebody managing only their own profile" "$c" 201

echo
printf ' PASSED: %s   FAILED: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
