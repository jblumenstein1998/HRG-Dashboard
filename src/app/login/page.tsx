import LoginForm from "@/components/LoginForm";

/**
 * Sign-in.
 *
 * A server component so the page arrives fully rendered. The Google callback
 * redirects here with ?error= when it turns someone away, and reading that with
 * useSearchParams in a client component would have required a Suspense
 * boundary — which prerendered to an empty shell in production and only filled
 * in after hydration.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const error = (await searchParams).error;
  return <LoginForm callbackError={typeof error === "string" ? error : undefined} />;
}
