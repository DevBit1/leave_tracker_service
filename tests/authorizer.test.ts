jest.mock("jsonwebtoken");

import { mockClient } from "aws-sdk-client-mock";
import { handler } from "../src/auth/authorizer";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import * as jwt from "jsonwebtoken";

const secretsManagerMock = mockClient(SecretsManagerClient);
const mockedJwtVerify = jwt.verify as jest.Mock;

describe("Authorizer Handler", () => {
  const event = {
    headers: { Authorization: "Bearer valid.token.here" },
    methodArn:
      "arn:aws:execute-api:us-east-1:123456789012:example/prod/GET/resource",
  };

  beforeEach(() => {
    process.env.SECRET_NAME = "test";

    secretsManagerMock.reset();
    jest.resetAllMocks();

    secretsManagerMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({ JWT_SECRET: "test_secret" }),
    });

    mockedJwtVerify.mockReturnValue({ email: "test@123.com", username: "testuser" });
  });

  afterAll(() => {
    delete process.env.SECRET_NAME;
  });

  test("Should return Allow policy when token is valid", async () => {
    const result = await handler(event as any);

    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result?.context?.userId).toBe("test@123.com");
    expect(result?.context?.userName).toBe("testuser");
  });

  test("Should return Deny policy when token is invalid", async () => {
    mockedJwtVerify.mockImplementationOnce(() => {
      throw new Error("Invalid token");
    });

    const result = await handler(event as any);

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  test("Should return Deny policy when token is missing", async () => {
    const event = {};

    const result = await handler(event as any);
    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  test("Should return Deny policy when JWT_SECRET is missing", async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolvesOnce({
      SecretString: JSON.stringify({}),
    });

    const result = await handler(event as any);

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });

  test("Should return empty values in context", async () => {
    mockedJwtVerify.mockReturnValue({});

    const result = await handler(event as any);

    console.log("Authorizer Result:", JSON.stringify(result, null, 2));

    expect(result.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(result?.context?.userId).toBe("");
    expect(result?.context?.userName).toBe("");
  })

  test("Should return Deny policy when Secret string is missing", async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolvesOnce({});

    const result = await handler(event as any);

    expect(result.policyDocument.Statement[0].Effect).toBe("Deny");
  });
});
