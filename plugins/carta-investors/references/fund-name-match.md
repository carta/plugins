# Match a fund name to a firm's fund

Use this rule to decide whether a fund name read from a document (an LPA, an
operating agreement, a side letter) and a fund name in the firm's fund list name
the same fund vehicle, and which of the firm's funds a document's name belongs
to. It is the rule `fund_key`, `fund_match`, `resolve_fund` and
`_series_for_agreement` apply in `skills/carta-lpa-audit/scripts/process.py`;
change them together.

Sibling vehicles at one firm often differ by one word: "Fund IV, LP" and "Fund IV
Holdings, LP", or "Fund III", "Fund III GP, LLC", "Fund III-A" and "Fund III
(Cayman)". So the match is word for word, never a similarity score: only
formatting is set aside, and every other word names the vehicle.

## Reduce each name to its identity words

Apply these steps in order to each name.

1. **A series named within its LLC becomes "‹LLC› - ‹series›".** A name of the
   form "‹series› of ‹parent›", where the parent ends in LLC, L.L.C., LP or L.P.,
   is rewritten that way: "Series I of Acme LLC" is "Acme LLC - Series I", and
   "Harbor Series (the "Series") of Acme Series LLC" is "Acme Series LLC - Harbor
   Series". "Kraken I, a Series of Acme LLC" is "Acme LLC - Kraken I Series". The
   rewrite applies only when the text before "of" ends with the word "Series"
   followed only by labels (a number, a Roman numeral, a letter or a letter-digit
   code: "Series A-1"), or when the name says "a Series of".
   "Acme Series A Fund of Funds, LP" and "Bank of America Fund LLC" stay as they
   are.
2. **Parentheticals come out of the name.** Each closed parenthetical is taken
   out. An unclosed one, from a "(" with no ")" after it to the end of the name
   ("Acme Fund IV (Cayman"), is dropped, whatever it holds. Of the closed ones,
   two kinds are dropped:
   - **Descriptive:** it holds a quotation mark, starts with "a", "an" or "the",
     or holds "limited partnership", "limited liability", "company",
     "corporation", "formerly", "previously", "f/k/a", "fka", "hereinafter" or
     "referred". So "(a Delaware limited partnership)", "(the "Partnership")" and
     "(formerly Beta Fund)" are dropped.
   - **A security or round label:** it holds one of the words Series, Class,
     Common, Preferred, Stock, Secondary, SAFE, Convertible, Note, Notes, Warrant,
     Warrants, Seed, Tranche, Bridge or Ext, or a month (January to December, or
     its short form: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Sept, Oct, Nov,
     Dec). So "(Series B)", "(Common Secondary)" and "(Convertible Note - June
     2023)" are dropped.

   Any other closed parenthetical, such as "(Cayman)", "(AIV)" or "(A)", is part
   of the name: its words join the identity words at the end (step 5).
3. **A series suffix is dropped.** When the name, without its parentheticals, has
   a spaced dash (" - ", " – " or " — ") and the text after the last one holds
   the word "Series" or "Class", that last segment is dropped: "Acme Owl, LLC -
   Series I", "Acme Series LLC – Widgets Series" and "Acme Fund IV - Class A" lose
   it. Only the last segment goes, and never a parenthetical. A dash with no space
   on each side is not a series suffix: "Fund IV-A" keeps its "A".
4. **The rest is split into words.** Case is set aside, "&" reads as "and",
   periods and apostrophes are removed ("L.P." is "LP", "O'Brien" is "OBrien"),
   and every other character that is not a letter or a digit separates words.
5. **One trailing legal form is set aside**, when at least one word stays before
   it: Limited Liability Company, Limited Partnership, LLC, L L C, LP, L P, LLLP,
   LLP, Ltd, Limited, Inc, Corp, Corporation, PBC, PLC, SCSp, SCS or SARL, longest
   first. LLLP counts as LP, Limited as Ltd and Corporation as Corp. Keep the form
   for step 7. Then add the words of the parentheticals kept in step 2.
6. **Filler and numerals.** The words "Fund", "The" and "And" are dropped. The
   Roman numerals I to XX become digits ("IV" is "4"), and a number loses leading
   zeros ("04" is "4"). XXI and above stay as written.

The words left are the name's identity words. A name with none left matches
nothing.

## Compare the two names

7. **Same words: a match.** The names match when their identity words, written
   together without spaces, are the same ("Acme Ventures" and "AcmeVentures"
   match). When both names state a legal form and the forms differ ("Acme Fund IV
   Holdings, LP" and "Acme Fund IV Holdings, LLC"), it is still a match, a weaker
   one than when the forms agree or one name states none.
8. **Close words: a close match.** Otherwise the names match when every word of
   each name has a counterpart in the other: the same word or, when both words
   have four or more letters and neither is a number, the same word with a typo or
   a plural ("Ventues" and "Ventures", "Opportunity" and "Opportunities"). A close
   match is the weakest kind.
9. **Anything else is a different vehicle.** A word with no counterpart, such as
   "Holdings", "GP", "Parallel", "Cayman", "AIV" or a series letter, means a
   different vehicle, however alike the rest of the two names are. So "Example
   Fund IV, L.P." matches "Example Fund 4 LP" and "Example IV LP", but not
   "Example Fund IV Holdings, LP", "Example Fund IV-A, L.P." or "Example Fund IV
   (Cayman), L.P.".

## Pick the fund

To find which of the firm's funds a document's name belongs to, compare it with
every fund in the firm's list.

**The strongest kind of match wins:** same words and form, then same words with a
different form, then close.

**A tie between one vehicle's rounds gives the name to all of them.** When funds
tie for the strongest match, all reduce to the same identity words and no two
state different legal forms, they are one vehicle's rounds ("Acme Fund I, L.P.
(Series A)" and "Acme Fund I, L.P. (Series B)"), and the name belongs to each.
Any other tie, such as "Acme Fund I" against "Acme Fund I, L.P." and "Acme Fund
I, LLC", is the calling skill's to settle.

**A tie between distinct series of one LLC gives the name only to its own
series.** When the tied funds are distinct series of one LLC (their spaced-dash
series segments, step 3, differ: "Acme Owl LLC - Series I" and "Acme Owl LLC -
Series II"), the name goes only to the series its own spaced-dash segment labels,
or to that series' classes ("Acme Owl LLC - Series I- Class A"). The segment is
compared with its words kept, including a series named within its LLC (step 1):
"Series I of Acme Owl LLC" labels Series I. A name that labels none of them, such
as the LLC's own agreement, is the calling skill's to settle.

**When no fund matches, a series named on its own goes to that series.** A name
that says it is a series, without its LLC ("Harbor Continuation Series"), goes to
the firm's series of that name ("Acme Series LLC - Harbor Continuation Series"),
or to that series' classes, when exactly one LLC at the firm has a series by that
name. The name needs a word beyond the series word and its label: "Series I"
alone says which series of some LLC, not which LLC, so it goes nowhere.

**Failing that, a name written with initials goes to the one fund it spells
out.** The name goes to the one fund whose name is the same as it with one run of
two or more words, each made only of letters, written as initials, either way round:
"AV Global I, L.P." and "Acme Ventures Global I, L.P." The identity words are
compared. When no fund or more than one fits, the name goes nowhere. A GP entity's
name is never read the initials way, as the document's name or the fund's: one
that ends in "GP" or "Management", then optionally a numeral, and then LLC, Ltd,
LLP, Corp, Corporation, Inc or Co, such as "Acme Ventures GP, LLC" or "Acme
Ventures GP II, LLC".
