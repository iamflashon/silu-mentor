export function memberLoginPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/";
  return `/member-login?return_to=${encodeURIComponent(safe)}`;
}
