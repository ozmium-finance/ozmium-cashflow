import { createSlice } from "@reduxjs/toolkit";

// Small odds and ends worth remembering while you click between pages --
// which investor you were looking at, what you'd typed into the audit
// search box -- so switching tabs to check something on the Operator
// page and coming back doesn't lose your place.
const initialState = {
  investorParty: "",
  auditSearch: "",
  auditStatusFilter: "",
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setInvestorParty(state, action) { state.investorParty = action.payload; },
    setAuditSearch(state, action) { state.auditSearch = action.payload; },
    setAuditStatusFilter(state, action) { state.auditStatusFilter = action.payload; },
  },
});

export const { setInvestorParty, setAuditSearch, setAuditStatusFilter } = uiSlice.actions;
export default uiSlice.reducer;
