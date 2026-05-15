# Work Tracker Documentation

## Features

This application is a comprehensive "Work Tracker" designed to log daily work hours, calculate overtime, sync securely with the cloud, and provide financial insights.

### 1. Work Log Tracking
*   **Time Entry**: Log start and end times, alongside break durations (in minutes).
*   **Day Off & Overtime Marking**: Explicit toggles for marking a day as a "Day Off" or "Whole Day OT (Overtime)".
*   **Automatic Calculation**: It calculates total hours and dynamically infers overtime by comparing the worked time against the user-configured **Standard Daily Hours**.

### 2. Financial Integration
*   **Hourly Rate**: Users can input their hourly rate, which computes estimated earnings (Total Salary, Overtime Pay) across specific periods.

### 3. Localization & Accessibility (i18n)
*   **Multiple Languages**: Supports English, Arabic, Filipino, Hindi, Urdu, and Bengali.
*   **RTL Support**: Native layout shifting (Right-To-Left) for Arabic out-of-the-box.
*   **Dark/Light Mode**: User-driven theme selection natively hooked into `tailwindcss` (`dark:` variant).

### 4. Cloud Sync & Multi-Device
*   **Firebase Authentication**: Users login seamlessly with Google Auth.
*   **Firestore Database**: Secure data synchronization. Settings and logs are pushed and pulled live from Firestore Enterprise.
*   **Offline / Guest Mode (Local Storage)**: If a user isn't logged in (or offline), data gracefully falls back to `localStorage` enabling instant usage before committing to sign-up.

### 5. Period Viewing & Calendar
*   **Views**: Toggle between generic "Monthly View" vs "Cycle View".
*   **Flexible Pay Period**: Users uniquely define their "Pay Period Start Day" allowing it to fit non-standard contracting cycles.

### 6. Notifications
*   **Reminders**: Built-in browser/tab notification engine that triggers at a specified `reminderTime` if the app is open.

### 7. Progressive Web App (PWA)
*   **Installable App**: Includes a Service Worker configured via `vite-plugin-pwa` allowing users to install the tracker on their Desktop or Mobile devices with offline caching.

---

## Technical Tricks Used

### Single Source Of Truth (State -> LocalStorage -> Firestore)
One primary trick is the "waterfall persistence". To afford a smooth offline experience, the tracker uses React state initialized via lazily evaluated functions checking `localStorage`. If `user` is authenticated, `onAuthStateChanged` fetches cloud data, reconciling differences, and subsequently using Firestore as the true backend.
### React `useEffect` for Live Time Evaluation
The application utilizes an interval hook to check the user's `reminderTime` against the real clock natively and trigger a Browser `Notification.requestPermission() / new Notification()`.
### Math-Based Date Generation
Calendar views don't rely on huge external libraries (like `moment.js` or `date-fns`). It calculates days using `new Date(year, month, 0).getDate()` to populate grid layouts efficiently.
### Tailwind Group Hovers & Transitions
We leverage `group-hover:scale-X` and customized `p-X` padding dynamically conditionally styled depending on data attributes. Use of RTL tailwind prefixes like `rtl:text-right`.

---

## Best Practices Used

*   **Security Error Catching**: Explicit `FirestoreErrorInfo` interfaces used alongside `handleFirestoreError` throwing standardized JSON data for precise SIEM/analytics alerting when operations fail (like Auth mismatch or quota limits).
*   **Typescript Defensively**: Everything leverages Interfaces, checking null states (e.g., `hourlyRate === ""` -> parsed to `null` or `number`).
*   **Responsive Desktop/Mobile First**: Fluid containers (`w-full`, `max-w-*`) are used, scaling effectively from narrow phone screens up to large monitors.
*   **Lazy State Initialization**: Features like `useState(() => localStorage.getItem('x') || 'y')` ensure Local Storage parses are only executed *once* at initialization, avoiding blocking re-renders.

---

## Security Threats & Mitigations

### 1. Insecure Firestore Rules (Mitigated)
*   *Threat*: A malicious actor alters queries to scrape other users' work logs or modifies settings dynamically.
*   *Mitigation*: We implement **Attribute-Based Access Control (ABAC)**. Firestore rules enforce that `userId` matches `request.auth.uid`. Also, robust Schema Validation on the `firestore.rules` enforces that properties matches correctly.
### 2. Cross-Site Scripting (XSS)
*   *Threat*: Injection of scripts via custom Time Entry or UI.
*   *Mitigation*: React natively escapes strings rendered in the DOM. User inputs are restricted using `<input type="number">` or `<input type="time">` and parsed through `parseFloat` stripping execution abilities.
### 3. Local Storage Tampering
*   *Threat*: Users directly editing `localStorage` values to bypass UI to break the application layout.
*   *Mitigation*: Component loading parses and falls back gracefully. E.g., `parseInt(breakMinutes) || 0`.

---

## Clean Coding Recommendations
To elevate the codebase further in future iterations, consider:

1.  **Component Splitting**: `App.tsx` contains a massive tree. Splitting it into `/components/Settings.tsx`, `/components/CalendarGrid.tsx`, and `/components/LogForm.tsx` would make testing and maintenance significantly easier.
2.  **Custom Hooks**: Extracting the Firebase and LocalStorage waterfall persistence logic into a custom `useSynchronizedState<T>(key, default, user)` hook to clean up the dozens of `useEffect` declarations.
3.  **Zod Schema Validation**: Use a library like `zod` alongside the application to ensure typestrict guarantees when downloading from Firestore or parsing from Local Storage.
4.  **Absolute Imports Setup**: Enacting `@/components` structural imports in `tsconfig.json` to keep directory depths clean instead of `../../components`.
