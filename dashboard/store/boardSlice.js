import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  contractsByStage: {},
  status: "idle", // idle | ok | err
  lastUpdate: null,
  error: null,
};

const boardSlice = createSlice({
  name: "board",
  initialState,
  reducers: {
    setBoardOk(state, action) {
      state.contractsByStage = action.payload;
      state.status = "ok";
      state.lastUpdate = new Date().toISOString();
      state.error = null;
    },
    setBoardError(state, action) {
      state.status = "err";
      state.error = action.payload;
    },
  },
});

export const { setBoardOk, setBoardError } = boardSlice.actions;
export default boardSlice.reducer;
