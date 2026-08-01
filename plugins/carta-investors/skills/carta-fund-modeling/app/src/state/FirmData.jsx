// Per-firm "extras" loaded at firm-select time and provided through context so
// the views render whichever firm is active: pacing + LP base (Overview),
// company ownership (Companies "Owned %" stat) and GP base (GP Economics
// "GP partner carry" table).
import { createContext, useContext } from "react";

export const FirmDataContext = createContext({ pacing: null, ownership: null, lpBase: null, gpBase: null, slug: null });
export const useFirmData = () => useContext(FirmDataContext);
