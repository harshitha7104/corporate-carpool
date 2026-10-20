import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import { createBrowserRouter, createMemoryRouter, RouterProvider } from "react-router-dom";
import Form from "./components/Form.jsx";
import Login from "./components/Login.jsx";
import App from "./App.jsx";
import OfferRide from "./components/OfferRide.jsx";
import Signup from "./components/Signup.jsx";
import Confirm from "./components/confirm.jsx";
import MyRides from "./components/MyRides.jsx";

// The claude.ai-hosted page cannot change its own URL path.
const createRouter = import.meta.env.MODE === "hosted" ? createMemoryRouter : createBrowserRouter;

const router = createRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/Signup",
    element: <Signup />,
  },
  {
    path: "/form",
    element: <Form />,
  },
  {
    path: "/ride",
    element: <OfferRide />,
  },
  {
    path: "/book",
    element: <Confirm />,
  },
  {
    path: "/my-rides",
    element: <MyRides />,
  },
  {
    path: "*",
    element: <App />,
  },
]);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
