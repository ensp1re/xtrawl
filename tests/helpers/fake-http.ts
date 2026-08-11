import type {
  HttpRequestOptions,
  HttpResponse,
  HttpSession,
  SessionFactory,
  SessionFactoryOptions,
} from "../../src/domain/http.js";

export interface FakeRequest {
  readonly url: string;
  readonly options: HttpRequestOptions;
}

export function response(body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, headers, text: async () => text, json: async () => JSON.parse(text) as unknown };
}

export function sessionFactory(
  handler: (request: FakeRequest) => HttpResponse | Promise<HttpResponse>,
  requests: FakeRequest[] = [],
): SessionFactory {
  return (options: SessionFactoryOptions): HttpSession => {
    const request = async (url: string, requestOptions: HttpRequestOptions = {}) => {
      const request = { url, options: requestOptions };
      requests.push(request);
      return handler(request);
    };
    return {
      cookies: options.cookies,
      get: request,
      post: request,
      close: async () => undefined,
    };
  };
}

export function tweetPayload(cursor = "next-cursor"): Record<string, unknown> {
  return {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  {
                    entryId: "tweet-1",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "1",
                            legacy: {
                              id_str: "1",
                              full_text: "hello",
                              created_at: "today",
                              favorite_count: 3,
                              retweet_count: 2,
                              reply_count: 1,
                              extended_entities: { media: [{ media_url_https: "https://img.test/a.jpg" }] },
                            },
                            core: {
                              user_results: {
                                result: { rest_id: "u1", legacy: { screen_name: "demo", name: "Demo" } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  { entryId: "cursor-bottom-1", content: { value: cursor, cursorType: "Bottom" } },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

export function userPayload(username = "demo", id = "u1"): Record<string, unknown> {
  return {
    data: {
      user: {
        result: {
          rest_id: id,
          legacy: {
            screen_name: username,
            name: "Demo",
            description: "Bio",
            followers_count: 10,
            friends_count: 5,
            statuses_count: 20,
            protected: false,
            verified: false,
            profile_image_url_https: "https://img.test/profile.jpg",
          },
        },
      },
    },
  };
}

export function profilePayload(): Record<string, unknown> {
  const payload = tweetPayload();
  const data = payload.data as Record<string, unknown>;
  const search = data.search_by_raw_query as Record<string, unknown>;
  const timeline = search.search_timeline as Record<string, unknown>;
  const timelineBody = timeline.timeline as Record<string, unknown>;
  return {
    data: { user: { result: { timeline: { timeline: { instructions: timelineBody.instructions } } } } },
  };
}

export function tweetResultPayload(): Record<string, unknown> {
  const payload = tweetPayload();
  const data = payload.data as Record<string, unknown>;
  const search = data.search_by_raw_query as Record<string, unknown>;
  const timeline = search.search_timeline as Record<string, unknown>;
  const timelineBody = timeline.timeline as Record<string, unknown>;
  const instructions = timelineBody.instructions as Array<Record<string, unknown>>;
  const entries = instructions[0]?.entries as Array<Record<string, unknown>>;
  const content = entries[0]?.content as Record<string, unknown>;
  const itemContent = content.itemContent as Record<string, unknown>;
  const tweetResults = itemContent.tweet_results as Record<string, unknown>;
  return { data: { tweetResult: { result: tweetResults.result } } };
}

export function followsPayload(): Record<string, unknown> {
  return {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    {
                      entryId: "user-1",
                      content: {
                        itemContent: {
                          user_results: {
                            result: { rest_id: "u2", legacy: { screen_name: "other", name: "Other" } },
                          },
                        },
                      },
                    },
                    { entryId: "cursor-bottom-1", content: { value: "follow-cursor", cursorType: "Bottom" } },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
}
