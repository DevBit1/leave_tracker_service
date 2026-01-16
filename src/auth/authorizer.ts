import {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from "aws-lambda";
import { secretsManagerClient } from "../utils/secretsClient";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import jwt from "jsonwebtoken";

const command = new GetSecretValueCommand({
  SecretId: process.env.SECRET_NAME!,
});

/* 
    Permissions needed by this function:
    1. secretsmanager:GetSecretValue on the secret identified by SECRET_NAME
    2. CloudWatch Logs permissions to write logs
*/

export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  try {
    const authHeader =
      event?.headers?.["Authorization"] ||
      event?.headers?.["authorization"] ||
      "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      throw new Error("Token missing");
    }

    console.log("Token: ", token);
    console.log("Secret name: ", process.env.SECRET_NAME);
    console.log("Command: ", command);

    const secretResponse = await secretsManagerClient.send(command);

    console.log("Secret response: ", secretResponse);

    const { JWT_SECRET = "" } = JSON.parse(secretResponse.SecretString || "{}");

    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET not found");
    }

    // Simple checking if its a valid token
    const decoded = jwt.verify(token, JWT_SECRET) as Record<string, string>;

    console.log("Decoded token: ", decoded);

    return {
      principalId: "user",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "execute-api:Invoke",
            Resource: event.methodArn,
          },
        ],
      },
      context: {
        userId: decoded.email || "",
        userName: decoded.username || "",
      }
    };

  } catch (error) {
    console.error("Authorization error: ", error);
    return {
      principalId: "user",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Deny",
            Action: "execute-api:Invoke",
            Resource: event.methodArn,
          },
        ],
      },
    };
  }
};
