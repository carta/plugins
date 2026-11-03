// Shared by FirmChooser and FirmDisambiguator so their two "which Carta firm is this" captions
// (the only thing that tells two same-named firms apart) can't independently drift.
export function cartaIdLabel(firm) {
  return firm?.firmId != null ? `Carta ID ${firm.firmId}` : null;
}
