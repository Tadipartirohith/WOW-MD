/**
 * The catalog's field specs and their validation, read from the web client.
 *
 * The same rule as the other modules in this directory: a shared module must be
 * dependency-free, and lib/dynamic-form.ts is — it was split out of that app's
 * DynamicForm component precisely so it could be, because the component imports
 * React and an uploader that only exists in a browser.
 *
 * Worth sharing rather than reimplementing because both clients render the same
 * catalog questions from the same `/catalog/services/:id` payload, and both
 * check the answers before sending them. Two copies of `validateAnswers` is two
 * opinions about what a valid guest count is, and the one that is wrong is the
 * one that lets a vendor fill in a form the API then refuses — on the platform
 * where they cannot open a console to find out why.
 *
 * The rendering is deliberately not shared: see components/dynamic-form.tsx,
 * which draws these same specs with native controls.
 */
export * from '../../../frontend/src/lib/dynamic-form';
