// Per-firm "extras" loaded at firm-select time and provided through context so
// the views render whichever firm is active: pacing + LP base (Overview),
// company ownership (Companies "Owned %" stat) and GP base (GP Economics
// "GP partner carry" table). Fund Construction reads feeHistory, expenseHistory and opsBenchmarks.
import { createContext, useContext } from "react";

export const FirmDataContext = createContext({ pacing: null, ownership: null, lpBase: null, gpBase: null, feeHistory: null, expenseHistory: null, opsBenchmarks: null, slug: null });
export const useFirmData = () => useContext(FirmDataContext);
