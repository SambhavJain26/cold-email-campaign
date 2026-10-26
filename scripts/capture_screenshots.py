import os
import time
from playwright.sync_api import sync_playwright

def capture():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(output_dir, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1366, "height": 860})
        page = context.new_page()

        # 01 Login Portal
        print("[1/7] Capturing Login Screen...")
        page.goto("http://localhost:5173/login", wait_until="networkidle")
        time.sleep(1.5)
        page.screenshot(path=os.path.join(output_dir, "01-login-screen.png"), full_page=False)

        # Log in
        print("[*] Logging in as Operator...")
        page.fill('input[type="email"]', "operator@outbound.engine")
        page.fill('input[type="password"]', "SovereignPass2025!")
        page.click('button[type="submit"]')
        page.wait_for_url("**/overview", timeout=10000)
        time.sleep(2)

        # 02 Overview Dashboard
        print("[2/7] Capturing Overview Dashboard...")
        page.screenshot(path=os.path.join(output_dir, "02-overview-dashboard.png"), full_page=False)

        # 03 Campaigns Page
        print("[3/7] Capturing Campaigns Management...")
        page.goto("http://localhost:5173/campaigns", wait_until="networkidle")
        time.sleep(2)
        page.screenshot(path=os.path.join(output_dir, "03-campaign-management.png"), full_page=False)

        # 04 Sequences Page / Builder
        print("[4/7] Capturing Sequence Builder...")
        page.goto("http://localhost:5173/sequences", wait_until="networkidle")
        time.sleep(1.5)
        # Click first sequence if present, or navigate to detail
        first_seq_link = page.locator('a[href^="/sequences/"]').first
        if first_seq_link.is_visible():
            first_seq_link.click()
            time.sleep(2)
        else:
            page.goto("http://localhost:5173/sequences/1", wait_until="networkidle")
            time.sleep(2)
        page.screenshot(path=os.path.join(output_dir, "04-sequence-builder.png"), full_page=False)

        # 05 Unibox Page
        print("[5/7] Capturing Unibox Unified Triage...")
        page.goto("http://localhost:5173/unibox", wait_until="networkidle")
        time.sleep(2)
        page.screenshot(path=os.path.join(output_dir, "05-unibox-triage.png"), full_page=False)

        # 06 Analytics Page
        print("[6/7] Capturing Analytics & Metrics Reconciliation...")
        page.goto("http://localhost:5173/analytics", wait_until="networkidle")
        time.sleep(2)
        page.screenshot(path=os.path.join(output_dir, "06-analytics-reconciliation.png"), full_page=False)

        # 07 Mailboxes Page
        print("[7/7] Capturing Mailbox Health & Capacity Pacing...")
        page.goto("http://localhost:5173/mailboxes", wait_until="networkidle")
        time.sleep(2)
        page.screenshot(path=os.path.join(output_dir, "07-mailbox-health.png"), full_page=False)

        browser.close()
        print("All 7 screenshots successfully captured in docs/screenshots!")

if __name__ == "__main__":
    capture()
