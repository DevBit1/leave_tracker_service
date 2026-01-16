import { APIGatewayEvent } from "aws-lambda";
import { docClient } from "../utils/db";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getLeaveId, Leave, Response, ResponseObj } from "../types";
import { validateDate } from "../helpers";
import { sfnClient } from "../utils/sfnClient";
import { StartExecutionCommand } from "@aws-sdk/client-sfn";

// Permissions this function needs:
// 1. DynamoDB Write/Read access to LEAVE_TABLE_NAME
// 2. CloudWatch Logs permissions to write logs
// 3. Step Functions StartExecution permission

export const handler = async (event: APIGatewayEvent): Promise<Response> => {
  try {
    const { body = {} } = event;

    if (!body || typeof body !== "string") {
      return new ResponseObj(400, { message: "Invalid request body" });
    }

    const parsedBody = JSON.parse(body);
    const { from, to, reason = "", fromTime = "", toTime = "" } = parsedBody;

    if (!from || !to) {
      return new ResponseObj(400, { message: "from and to are required" });
    }

    if (!validateDate(from) || !validateDate(to)) {
      return new ResponseObj(400, {
        message: "Invalid date format ex: (MM/DD/YYYY), (YYYY-MM-DD)",
      });
    }

    if (new Date(from) > new Date(to)) {
      return new ResponseObj(400, { message: "from cannot be later than to" });
    }

    if (new Date(from) < new Date()) {
      return new ResponseObj(400, {
        message: "from date cannot be in the past",
      });
    }

    console.log("Request body parsed:", event);

    // Check whether the data is coming from the right key
    // "userId" -> user email
    const { userId = "", userName = "" } = event.requestContext
      .authorizer as Record<string, string>;

    if (!userId || !userName) {
      return new ResponseObj(400, { message: "Unauthorized entity" });
    }

    // Check if there is pending leave for the user in the given date range
    const existingLeaveCommand = new GetCommand({
      TableName: process.env.LEAVE_TABLE_NAME!,
      Key: {
        leaveId: getLeaveId(userId, new Date(from), new Date(to)),
      },
    });

    const existingLeave = await docClient.send(existingLeaveCommand);

    if (existingLeave?.Item?.status === "PENDING") {
      return new ResponseObj(409, {
        message: "There is already a leave application for the given dates",
      });
    }

    const leaveObj = new Leave({
      fromDate: new Date(from).toISOString(),
      toDate: new Date(to).toISOString(),
      reason,
      applicantId: userId,
      applicantName: userName,
    });

    const putCommand = new PutCommand({
      TableName: process.env.LEAVE_TABLE_NAME || "leave-management-skr",
      Item: leaveObj,
      ConditionExpression: `attribute_not_exists(#leaveId)`,
      ExpressionAttributeNames: {
        "#leaveId": getLeaveId(
          leaveObj.applicantId,
          new Date(leaveObj.fromDate),
          new Date(leaveObj.toDate)
        ),
      },
    });

    await docClient.send(putCommand);

    // Trigger the step function to process the leave application
    // (e.g., send notification to manager, etc.)
    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn: process.env.LEAVE_PROCESSING_STATE_MACHINE_ARN!,
      input: JSON.stringify({
        type: "request",
        timeoutSecondsForRequest: Math.floor(
          (new Date(to).getTime() - new Date(from).getTime()) / 1000
        ),
        ...leaveObj,
      }),
    });

    await sfnClient.send(startExecutionCommand);

    return new ResponseObj(201, {
      message: "Leave application submitted",
      leaveObj,
    });
  } catch (error) {
    console.error("Error in leave_generate handler:", error);
    return new ResponseObj(500, { message: "Internal server error" });
  }
};
