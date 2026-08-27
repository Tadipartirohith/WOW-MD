#!/bin/sh
# Identity verification, shared by every live suite.
#
# Interests, accepting an interest and fixing a match all require the subject
# profile's identity document to have been confirmed. That is a deliberate
# gate — an unverified profile advancing through matchmaking was the reported
# defect — but it means a suite that wants to exercise anything past "send an
# interest" has to take its personas through verification first.
#
# Sourced rather than copied so there is one Verhoeff implementation. Expects
# `req` to already be defined by the calling suite.

# Aadhaar's check digit, computed rather than typed.
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

# A fresh, valid Aadhaar every call.
#
# One document, one profile is enforced by a unique index, so two personas in
# the same run must not be handed the same number — the second would be refused
# with a 409 that looks nothing like the thing under test.
#
# Drawn from the kernel's random source rather than a counter, because every
# call site is a `$(...)` and therefore a subshell: a counter incremented in
# there is discarded on return, so an earlier version of this handed out the
# same number every time and the suites failed in a way that read like the gate
# was broken rather than the fixture.
next_aadhaar() {
  na_digits=$(head -c 64 /proc/sys/kernel/random/uuid | tr -dc '0-9')
  # Enough digits, whatever the uuid happened to contain.
  while [ ${#na_digits} -lt 11 ]; do
    na_digits="$na_digits$(head -c 64 /proc/sys/kernel/random/uuid | tr -dc '0-9')"
  done
  na_body=$(printf '%.11s' "$na_digits")

  # Aadhaar never begins 0 or 1 — that range is reserved.
  case "$na_body" in
    0*|1*) na_body="2${na_body#?}" ;;
  esac
  printf '%s%s' "$na_body" "$(verhoeff "$na_body")"
}

# verify_identity <profileId> <token> -> echoes the Aadhaar used.
#
# Goes through the real OTP flow rather than reaching into the database: the
# point of a live suite is that the path a person takes is the path under test.
# `AADHAAR_PROVIDER=mock` returns the code on the response, which is the only
# reason this is possible without an SMS gateway.
#
# Complains on stderr when it cannot verify. A fixture that fails quietly makes
# every assertion after it fail for the wrong stated reason, which costs more
# time to diagnose than the original failure would have.
verify_identity() {
  vi_profile=$1
  vi_token=$2
  vi_number=$(next_aadhaar)

  vi_code_http=$(req POST "/profiles/$vi_profile/identity/aadhaar/send-otp" \
    "{\"aadhaarNumber\":\"$vi_number\"}" "$vi_token")
  vi_session=$(jq -r '.sessionId // empty' /tmp/body)
  if [ -z "$vi_session" ]; then
    printf '  (fixture) could not start verification for %s: HTTP %s %s\n' \
      "$vi_profile" "$vi_code_http" "$(head -c 160 /tmp/body)" >&2
    return 1
  fi
  vi_devcode=$(jq -r '.devCode // empty' /tmp/body)

  vi_code_http=$(req POST "/profiles/$vi_profile/identity/aadhaar/verify-otp" \
    "{\"sessionId\":\"$vi_session\",\"code\":\"$vi_devcode\"}" "$vi_token")
  if [ "$vi_code_http" != "200" ]; then
    printf '  (fixture) could not confirm verification for %s: HTTP %s %s\n' \
      "$vi_profile" "$vi_code_http" "$(head -c 160 /tmp/body)" >&2
    return 1
  fi
  printf '%s' "$vi_number"
}
