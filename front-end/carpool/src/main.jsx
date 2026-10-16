import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import Header from "./components/Header.jsx";
import Form from "./components/Form.jsx";
import Login from "./components/Login.jsx";
import App from "./App.jsx";
import OfferRide from "./components/OfferRide.jsx";
import Signup from "./components/Signup.jsx";
import Confirm from "./components/confirm.jsx";
import MyRides from "./components/MyRides.jsx";

const Layout = () => (
  <>
    <Header />
    <Outlet />
  </>
);

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
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
    ],
  },
]);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
