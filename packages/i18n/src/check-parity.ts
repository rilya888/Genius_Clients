import { assertDictionaryParity } from "./dictionaries";

const parity = assertDictionaryParity();

if (parity.missingInIt.length > 0 || parity.missingInEn.length > 0) {
  console.error("[i18n] dictionary parity check failed");
  if (parity.missingInIt.length > 0) {
    console.error("Missing in it:", parity.missingInIt);
  }
  if (parity.missingInEn.length > 0) {
    console.error("Missing in en:", parity.missingInEn);
  }
  process.exit(1);
}

console.log("[i18n] dictionary parity check passed");
