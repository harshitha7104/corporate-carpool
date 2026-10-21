import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "./auth";

const renderLogin = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/login"]}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>
  );

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

afterEach(() => vi.restoreAllMocks());

describe("sign-in form", () => {
  it("rejects numbers that aren't Indian mobile numbers without calling the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((url) => (String(url).includes("/auth/session") ? json({ user: null }) : json({})));
    renderLogin();
    const input = await screen.findByLabelText("Mobile number");
    await userEvent.type(input, "12345");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/10-digit Indian mobile number/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/otp/request"))).toBe(false);
  });

  it("requests a code for a valid number and shows the development code notice", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).includes("/auth/session")) return json({ user: null });
      if (String(url).includes("/auth/otp/request")) return json({ challengeId: "c1", channel: "sms", expiresInSeconds: 600, devCode: "123456" });
      return json({});
    });
    renderLogin();
    await userEvent.type(await screen.findByLabelText("Mobile number"), "98450 12345");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enter your code" })).toBeInTheDocument());
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByText(/never show it here/)).toBeInTheDocument();
  });

  it("shows the server's message for a wrong code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).includes("/auth/session")) return json({ user: null });
      if (String(url).includes("/auth/otp/request")) return json({ challengeId: "c1", channel: "sms", expiresInSeconds: 600 });
      if (String(url).includes("/auth/otp/verify")) return json({ error: { code: "bad_request", message: "That code is not right. 4 attempts left." } }, 400);
      return json({});
    });
    renderLogin();
    await userEvent.type(await screen.findByLabelText("Mobile number"), "9845012345");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByText("That code is not right. 4 attempts left.")).toBeInTheDocument();
  });
});
