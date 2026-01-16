import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION_OP || "ap-south-1",
});
export const docClient = DynamoDBDocumentClient.from(ddbClient);
