import { configureStore } from "@reduxjs/toolkit";
import boardReducer from "./boardSlice";
import demoReducer from "./demoSlice";
import uiReducer from "./uiSlice";

export const store = configureStore({
  reducer: {
    board: boardReducer,
    demo: demoReducer,
    ui: uiReducer,
  },
});
