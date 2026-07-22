import { Provider } from "react-redux";
import { store } from "../store";
import Nav from "../components/Nav";
import BoardPoller from "../components/BoardPoller";
import "../styles/globals.css";

// The Provider (and BoardPoller inside it) lives here, above every page,
// and Next.js's client-side router never unmounts _app between page
// navigations -- only a real browser reload does. That's the whole fix:
// clicking Operator -> Investor -> Operator keeps the same Redux store
// alive in memory the entire time, no localStorage needed.
export default function OzmiumDashboardApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <BoardPoller />
      <Nav />
      <Component {...pageProps} />
    </Provider>
  );
}
