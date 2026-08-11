import { prepareAuthMaterial } from "../../src/auth/material.js";
import { AccountSessionAuthError, AuthError, NetworkError, RateLimitError } from "../../src/domain/errors.js";
import { GraphqlTransport } from "../../src/transport/graphql.js";
import { SessionBuilder, cookieHeader } from "../../src/transport/session.js";
import { TransactionIdProvider } from "../../src/transport/transaction-id.js";
import { response, sessionFactory } from "../helpers/fake-http.js";

describe("session boundaries", () => {
  test("requires both auth cookies and applies required headers", async () => {
    expect(() => prepareAuthMaterial({ username: "one", cookies: {}, authToken: "a" }, "bearer")).toThrow(
      AccountSessionAuthError,
    );
    const builder = new SessionBuilder({
      bearerToken: "bearer",
      factory: (options) => sessionFactory(() => response({ ok: true }))(options),
    });
    const session = builder.fromMaterial({
      authToken: "a",
      csrfToken: "b",
      bearerToken: "bearer",
      cookies: { auth_token: "a", ct0: "b" },
    });
    expect(cookieHeader(session.cookies)).toContain("auth_token=a");
    await expect(session.get("https://x.test")).resolves.toMatchObject({ status: 200 });
  });
});

describe("GraphQL transport", () => {
  test("maps remote auth and rate errors", async () => {
    const transport = new GraphqlTransport(new TransactionIdProvider());
    const authSession = sessionFactory(() => response({ errors: [{ message: "Unauthorized" }] }))({
      cookies: {},
    });
    const rateSession = sessionFactory(() => response({ errors: [{ message: "Rate limit exceeded" }] }))({
      cookies: {},
    });
    await expect(transport.get(authSession, "https://x.test", {}, 1000)).rejects.toThrow(AuthError);
    await expect(transport.get(rateSession, "https://x.test", {}, 1000)).rejects.toThrow(RateLimitError);
  });

  test("returns JSON data and status for successful responses", async () => {
    const transport = new GraphqlTransport(new TransactionIdProvider());
    const requests: Array<Record<string, unknown>> = [];
    const session = sessionFactory((request) => {
      requests.push(request.options as Record<string, unknown>);
      return response({ data: { ok: true } });
    })({ cookies: {} });
    await expect(transport.get(session, "https://x.test", { variables: "{}" }, 1000)).resolves.toMatchObject({
      status: 200,
      data: { data: { ok: true } },
    });
    expect(requests[0]?.body).toEqual({ variables: {} });
  });

  test("classifies HTTP status failures before decoding the body", async () => {
    const transport = new GraphqlTransport(new TransactionIdProvider());
    const auth = sessionFactory(() => response("denied", 403))({ cookies: {} });
    const rate = sessionFactory(() => response("slow down", 429))({ cookies: {} });
    const server = sessionFactory(() => response("broken", 503))({ cookies: {} });
    await expect(transport.get(auth, "https://x.test", {}, 1000)).rejects.toThrow(AuthError);
    await expect(transport.get(rate, "https://x.test", {}, 1000)).rejects.toThrow(RateLimitError);
    await expect(transport.get(server, "https://x.test", {}, 1000)).rejects.toThrow(NetworkError);
  });

  test("passes a transaction id to the HTTP session", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const session = sessionFactory((request) => {
      requests.push(request.options as Record<string, unknown>);
      return response({ data: { ok: true } });
    })({ cookies: {} });
    const transport = new GraphqlTransport(
      new TransactionIdProvider({ create: async () => "transaction-1" }),
    );
    await transport.get(session, "https://x.test", {}, 1000);
    expect(requests[0]?.headers).toEqual({ "X-Client-Transaction-Id": "transaction-1" });
  });
});
