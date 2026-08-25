export function memberLoginPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/";
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safe)}`;
}
