import { APIGatewayEvent } from "aws-lambda";
import { docClient } from "../utils/db";
import { sfnClient } from "../utils/sfnClient";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
} from "@aws-sdk/client-sfn";
import { ResponseObj } from "../types";

// Permissions this function needs:
/* 
    1. DynamoDB Read access to LEAVE_TABLE_NAME
    2. Step Functions SendTaskSuccess and SendTaskFailure permissions
*/

export const handler = async (event: APIGatewayEvent): Promise<any> => {
  try {
    const { path, pathParameters } = event;

    if (!pathParameters || !pathParameters["leaveId"]) {
      throw new Error("Missing leaveId in path parameters");
    }

    const leaveId = pathParameters["leaveId"];

    const getLeaveCommand = new GetCommand({
      TableName: process.env.LEAVE_TABLE_NAME!,
      Key: { leaveId },
    });

    const leaveData = await docClient.send(getLeaveCommand);

    if (!leaveData.Item) {
      throw new Error(`Leave with ID ${leaveId} not found`);
    }

    const leaveItem = leaveData.Item;

    if (leaveItem.status !== "PENDING") {
      return new ResponseObj(400, {
        message: `Leave with ID ${leaveId} has been already processed with status ${leaveItem.status}`,
      });
    }

    const action = path.split("/")[path.split("/").length - 2]; // expect /leave/accept/{leaveId} or /leave/reject/{leaveId}

    if (action === "reject") {
      const command = new SendTaskSuccessCommand({
        taskToken: leaveItem.task_token,
        output: JSON.stringify({
          type: "REJECT",
          applicantId: leaveItem.applicantId,
          applicantName: leaveItem.applicantName,
          fromDate: leaveItem.fromDate,
          toDate: leaveItem.toDate,
        }),
      });
      await sfnClient.send(command);
    } else if (action === "accept") {
      // Which output will take priority the one in SendTaskSuccessCommand or the one in the lambda function that sends notification ?
      // This output will sent because the lambda function's output will be ignored soon after the call
      const command = new SendTaskSuccessCommand({
        taskToken: leaveItem.task_token,
        output: JSON.stringify({
          type: "ACCEPT",
          applicantId: leaveItem.applicantId,
          applicantName: leaveItem.applicantName,
          fromDate: leaveItem.fromDate,
          toDate: leaveItem.toDate,
        }),
      });
      await sfnClient.send(command);
    } else {
      const command = new SendTaskFailureCommand({
        taskToken: leaveItem.task_token,
        error: "InvalidAction",
        cause: `The action ${action} is not valid. Expected ACCEPT or REJECT.`,
      });

      await sfnClient.send(command);

      return new ResponseObj(400, {
        message: `Invalid action: ${action}. Expected ACCEPT or REJECT.`,
      });
    }

    return new ResponseObj(200, {
      message: `Leave ${action}ed successfully`,
    });
  } catch (error) {
    console.error("Error while resuming state machine");
    return new ResponseObj(500, {
      message: "Internal server error",
      error: (error as Error).message,
    });
  }
};
