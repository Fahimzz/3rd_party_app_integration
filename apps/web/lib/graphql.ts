import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';

export function createApolloClient(token?: string) {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_GRAPHQL_URL,
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
    }),
  });
}
