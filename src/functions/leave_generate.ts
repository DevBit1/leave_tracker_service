import { APIGatewayEvent } from "aws-lambda";
import { docClient } from "../utils/db";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getLeaveId, Leave, Response, ResponseObj } from "../types";
import { validateDateInputs } from "../helpers";
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

    const isValidDateInputs = validateDateInputs(from, to, fromTime, toTime);

    if (!isValidDateInputs.valid) {
      return new ResponseObj(400, { message: isValidDateInputs.message });
    }


    // Check whether the data is coming from the right key
    // "userId" -> user email
    const { userId = "", userName = "" } = event.requestContext
      .authorizer as Record<string, string>;

    if (!userId || !userName) {
      return new ResponseObj(400, { message: "Unauthorized entity" });
    }

    // Create datetime objects with time information
    const fromDateTime = new Date(from);
    if (fromTime) {
      const [hours, minutes] = fromTime.split(":").map(Number);
      fromDateTime.setHours(hours, minutes, 0, 0);
    } else {
      fromDateTime.setHours(0, 0, 0, 0);
    }

    const toDateTime = new Date(to);
    if (toTime) {
      const [hours, minutes] = toTime.split(":").map(Number);
      toDateTime.setHours(hours, minutes, 0, 0);
    } else {
      toDateTime.setHours(23, 59, 59, 999);
    }

    // Check if there is pending leave for the user in the given date range
    const existingLeaveCommand = new GetCommand({
      TableName: process.env.LEAVE_TABLE_NAME!,
      Key: {
        leaveId: getLeaveId(userId, fromDateTime, toDateTime),
      },
    });

    const existingLeave = await docClient.send(existingLeaveCommand);

    if (existingLeave?.Item?.status === "PENDING") {
      return new ResponseObj(409, {
        message: "There is already a leave application for the given dates",
      });
    }

    const leaveObj = new Leave({
      fromDate: fromDateTime.toISOString(),
      toDate: toDateTime.toISOString(),
      reason,
      applicantId: userId,
      applicantName: userName,
    });

    const putCommand = new PutCommand({
      TableName: process.env.LEAVE_TABLE_NAME,
      Item: leaveObj,
      ConditionExpression: `attribute_not_exists(#leaveId)`,
      ExpressionAttributeNames: {
        "#leaveId": getLeaveId(leaveObj.applicantId, fromDateTime, toDateTime),
      },
    });

    await docClient.send(putCommand);

    // Trigger the step function to process the leave application
    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn: process.env.LEAVE_PROCESSING_STATE_MACHINE_ARN!,
      input: JSON.stringify({
        type: "request",
        timeoutSecondsForRequest: Math.floor(
          (toDateTime.getTime() - fromDateTime.getTime()) / 1000
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
