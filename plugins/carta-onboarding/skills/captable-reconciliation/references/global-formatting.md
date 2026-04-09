# Global Formatting Rules

Formatting checks that apply to ALL reconciliations (C-Corp and PE/LLC). These verify the OBS values follow Carta platform formatting requirements.

---

## Check 1: Date Format

For each date field in the OBS:
1. Is the format MM/DD/YYYY?
   - If NO → flag MAJOR: "Date not in MM/DD/YYYY format" — show actual format
2. Is the date ambiguous (day ≤ 12, so DD/MM/YYYY vs MM/DD/YYYY is unclear)?
   - If YES → check other dates in the same document for context
   - If still ambiguous → flag MAJOR: "Ambiguous date — could be {interpretation A} or {interpretation B}"

---

## Check 2: Name Consistency

For each holder across all OBS tabs:
1. Is the exact legal name used (not abbreviated)?
   - "John A. Smith" not "J. Smith"
   - Full entity suffix: "Acme Holdings, LLC" not "Acme Holdings"
   - If abbreviated → flag MAJOR: "Name appears abbreviated"
2. Is the name identical in every tab the holder appears in?
   - If NO → flag CRITICAL: "Name differs between tabs" — list tabs and values

---

## Check 3: Currency

For each transaction with a currency value:
1. Does the currency match the specific transaction's source document?
   - If NO → flag CRITICAL: "Currency mismatch — source doc says {X}, OBS says {Y}"
2. Is the value rounded?
   - Compare to source doc value character-for-character
   - If rounded → flag MAJOR: "Value appears rounded — source doc says {exact value}"
3. If currency is not specified in the source document:
   - Is the field highlighted yellow?
   - If NO → flag MAJOR: "Unknown currency not highlighted"

---

## Check 4: Prefixes and Certificate IDs

For each certificate ID in the OBS:
1. Is the ID unique across the entire OBS (all tabs)?
   - If duplicate → flag CRITICAL: "Duplicate certificate ID"
2. Does the prefix match the Share Classes tab?
   - If NO → flag CRITICAL: "Prefix mismatch — Share Classes says {X}, certificate says {Y}"
3. Standard Carta prefix conventions:
   - Common/Ordinary: CS-
   - ESOP: ES- (not ESOP-)
   - Preferred Series A/B/C: PSA-, PSB-, PSC-
   - SAFEs: SAFE-
   - If non-standard prefix used (e.g., OS-, ORD-, SAPS-) → flag MINOR: "Non-standard prefix — consider using Carta convention"

---

## Check 5: One Transaction Per Row

For each row in certificate/transaction tabs:
1. Does this row represent a single distinct transaction?
2. Are there suspiciously round sums that might indicate combined issuances?
   - Example: one row with 3,000,000 shares where source docs show three separate issuances of 1,000,000
   - If suspected → flag CRITICAL: "Possible combined issuances — source docs show {N} separate transactions"

---

## Check 6: Quantity and Cash Verification

For each certificate/transaction:
1. Does the quantity match the source document exactly (no dropped or added zeros)?
   - If NO → flag CRITICAL: "Quantity mismatch" — show both values
2. Does cash paid match the source document exactly?
   - If NO → flag CRITICAL: "Cash paid mismatch" — show both values
3. Quantity × PPS = cash paid?
   - If NO → flag CRITICAL: "Math error — quantity × PPS ≠ cash paid"

---

## Check 7: Price Per Share — Nominal vs Actual

For non-US companies with government register data:
1. Does the certificate PPS match the register's nominal/par value?
   - If NO → flag MAJOR: "Certificate PPS doesn't match register nominal value"
2. Is the actual economic investment price captured in Share Classes OIP field (not certificate PPS)?
   - If economic price is in certificate PPS → flag MAJOR: "Economic price should be in Share Classes OIP, not certificate PPS"

For all companies:
1. If no Cash Paid and no register price exists, is the PPS field highlighted yellow?
   - If blank without highlight → flag MAJOR: "Missing PPS not highlighted"
