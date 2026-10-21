import { expect, test, type Page } from "@playwright/test";

// A tiny valid PNG used as a stand-in document photo.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f00050002015d0d6e1a0000000049454e44ae426082",
  "hex"
);

// Next weekday in India time as YYYY-MM-DD (seeded demo rides run on weekdays).
const nextWeekday = (ahead = 1) => {
  const d = new Date(Date.now() + 330 * 60000);
  let n = 0;
  while (n < ahead) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) n += 1;
  }
  return d.toISOString().slice(0, 10);
};

const signIn = async (page: Page, phone: string) => {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  // The API enforces a 30-second gap between codes to one number; wait it out like a person would.
  // isVisible() doesn't wait, so wait for whichever answer arrives first.
  const wait = page.getByText("Please wait 30 seconds");
  await expect(page.getByText(/Your code is|Please wait 30 seconds/).first()).toBeVisible();
  if (await wait.isVisible()) {
    await page.waitForTimeout(31_000);
    await page.getByRole("button", { name: "Send code" }).click();
  }
  const code = (await page.getByText(/Your code is/).locator("span").first().textContent())!.trim();
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
};

const pickPlace = async (page: Page, label: string, query: string, option: string) => {
  await page.getByRole("combobox", { name: label, exact: true }).fill(query);
  await page.getByRole("option", { name: new RegExp(option) }).first().click();
};

test("public pages load and explain the product honestly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("shared seats");
  await page.getByRole("link", { name: "Safety", exact: true }).first().click();
  await expect(page.getByText(/not a police or criminal background check/)).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByText("Draft for the pilot")).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
});

test("new passenger signs up, finds a ride by typing places, books and pays", async ({ page }) => {
  await signIn(page, "98765 43210");
  await expect(page).toHaveURL(/\/app\/welcome/);
  await page.getByLabel("Full name").fill("Nandini Rao");
  await page.getByLabel(/Gender/).selectOption("female");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nandini");

  await page.getByRole("link", { name: "Find a ride" }).first().click();
  await pickPlace(page, "From", "Phoenix", "Phoenix Marketcity");
  await pickPlace(page, "To", "Manyata", "Manyata Tech Park");
  await page.getByLabel("Date").fill(nextWeekday());
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const card = page.getByRole("link").filter({ hasText: "Instant booking" }).filter({ hasText: "Arjun" }).first();
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.getByText("Cancellation terms")).toBeVisible();
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await expect(page).toHaveURL(/\/app\/bookings\//);
  await expect(page.getByText("Pay to confirm your seat")).toBeVisible();
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(page.getByText("No real money moves")).toBeVisible();
  await page.getByRole("button", { name: "Pay (simulated)" }).click();
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Simulated payment. No real money moved.")).toBeVisible();
});

test("driver accepts a pending request and the passenger sees it", async ({ page, browser }) => {
  await signIn(page, "9900000102");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/drive/requests");
  await page.getByRole("link").filter({ hasText: "Electronic City" }).filter({ hasText: "request" }).first().click();
  await expect(page.getByText("Hi! I work near Forum Mall")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Waiting for payment")).toBeVisible();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2, "9900000201");
  await expect(p2).toHaveURL(/\/app$/);
  await p2.goto("/app/trips");
  await p2.getByRole("tab", { name: /Pending/ }).click();
  await expect(p2.getByText("Awaiting payment").first()).toBeVisible();
  await other.close();
});

test("new driver verifies documents, an admin approves, and the driver publishes", async ({ page, browser }) => {
  await signIn(page, "9845076543");
  await page.getByLabel("Full name").fill("Kiran Shetty");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/drive/vehicles");
  await page.getByLabel("Make").fill("Tata");
  await page.getByLabel("Model").fill("Nexon EV");
  await page.getByLabel("Colour").fill("Blue");
  await page.getByLabel("Registration number").fill("KA 05 EV 7788");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  const files = page.locator('input[type="file"]');
  await files.nth(0).setInputFiles({ name: "rc.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Uploaded: rc.png")).toBeVisible();
  await files.nth(1).setInputFiles({ name: "insurance.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Uploaded: insurance.png")).toBeVisible();
  await page.getByLabel("Insurance valid until").fill("2030-03-31");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Pending review").first()).toBeVisible();

  await page.goto("/app/drive/verification");
  const idForm = page.locator("form").first();
  await idForm.getByLabel("Last 4 characters of the number").fill("4321");
  await idForm.locator('input[type="file"]').setInputFiles({ name: "aadhaar.png", mimeType: "image/png", buffer: PNG });
  await expect(idForm.getByText("Uploaded: aadhaar.png")).toBeVisible();
  await idForm.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Pending review")).toHaveCount(1);
  // The ID form disappears once submitted; the licence form is now first.
  const dlForm = page.locator("form").first();
  await dlForm.getByLabel("Last 4 characters of the number").fill("KA05");
  await dlForm.getByLabel("Valid until").fill("2034-01-31");
  await dlForm.locator('input[type="file"]').setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: PNG });
  await expect(dlForm.getByText("Uploaded: licence.png")).toBeVisible();
  await dlForm.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Pending review")).toHaveCount(2);

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, "9900000001");
  await expect(admin).toHaveURL(/\/app$/);
  for (const tab of ["ID and licences", "Vehicles"]) {
    await admin.goto("/admin/verifications");
    await admin.getByRole("tab", { name: tab }).click();
    const cards = admin.locator(".card").filter({ hasText: "Kiran Shetty" });
    // Wait for the queue to load before counting what's in it.
    await expect(cards.first()).toBeVisible();
    for (let left = await cards.count(); left > 0; left--) {
      await cards.first().getByRole("button", { name: "Approve" }).click();
      await admin.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
      await expect(cards).toHaveCount(left - 1);
    }
  }
  await adminCtx.close();

  await page.goto("/app/drive/new");
  await pickPlace(page, "Starting point", "HSR", "HSR Layout");
  await pickPlace(page, "Destination", "Ecoworld", "Ecoworld");
  await page.getByLabel("Date").fill(nextWeekday(2));
  await expect(page.getByText(/Suggested ₹/)).toBeVisible();
  await page.getByRole("button", { name: "Publish ride" }).click();
  await expect(page).toHaveURL(/\/app\/drive\/rides\//);
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
});

test("admin suspends an account with a recorded reason", async ({ page }) => {
  await signIn(page, "9900000001");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/admin/users");
  await page.getByLabel("Search users").fill("Kavya");
  await page.getByRole("link", { name: "Kavya Thomas" }).click();
  await page.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("dialog").getByLabel(/Reason/).fill("Repeated no-shows reported by drivers");
  await page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText("suspended", { exact: true }).first()).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByText("admin.user.suspend").first()).toBeVisible();
});

test("phone layout uses the bottom navigation without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "9900000202");
  await expect(page).toHaveURL(/\/app$/);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Trips" }).click();
  await expect(page.getByRole("heading", { name: "My trips" })).toBeVisible();
  await nav.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
