import { getErrorObj, sendEmailNotification } from "../helpers";
import { getLeaveId } from "../types";
import { docClient } from "../utils/db";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Permissions this function needs:
// 1. DynamoDB Write access to LEAVE_TABLE_NAME
// 2. DynamoDB Read access to USER_TABLE_NAME
// 3. SES SendEmail permission
// 4. CloudWatch Logs permissions to write logs

export interface EventObj {
  input: {
    type: "REQUEST" | "ACCEPT" | "REJECT";
    applicantId?: string; // The email of the user
    applicantName?: string;
    fromDate?: string;
    toDate?: string;
  };
  task_token?: string; // !!! Important for Step Functions integration
}

class NotificationResult {
  success: boolean;
  message: string;

  constructor(
    success: boolean,
    message: string,
    additionalData: { [key: string]: any } = {}
  ) {
    this.success = success;
    this.message = message;
    Object.assign(this, additionalData);
  }
}

export const handler = async (event: EventObj): Promise<any> => {
  try {
    const { applicantId, applicantName, fromDate, toDate, type } = event.input;

    console.log("notify_users event received:", JSON.stringify(event, null, 2));

    if (!type) {
      throw getErrorObj("InvalidEvent", "Event type is required");
    }

    if (!applicantId || !applicantName || !fromDate || !toDate) {
      throw getErrorObj(
        "InvalidEvent",
        "Missing required fields for leave request"
      );
    }

    const leaveId = getLeaveId(
      applicantId,
      new Date(fromDate),
      new Date(toDate)
    );

    let result = new NotificationResult(false, "No action taken");
    let updateLeaveCommand;

    switch (type.toUpperCase()) {
      case "REQUEST": {
        if (!event["task_token"]) {
          throw getErrorObj(
            "MissingTaskToken",
            "Task token is required for REQUEST type"
          );
        }

        const getAllAdminCommand = new QueryCommand({
          TableName: process.env.USER_TABLE_NAME!,
          IndexName: process.env.USER_GSI_NAME!,
          // "role" is reserved key word in DynamoDB, so we use ExpressionAttributeNames
          KeyConditionExpression: "#role = :admin",
          ExpressionAttributeNames: {
            "#role": "role",
          },
          ExpressionAttributeValues: {
            ":admin": "ADMIN",
          },
        });

        const resp = await docClient.send(getAllAdminCommand);

        if (!resp?.Items || !resp.Items?.length) {
          throw getErrorObj("NoAdminsFound", "No administrators found");
        }

        const adminEmails = resp.Items.filter(
          (admin) => admin.email !== applicantId
        ).map((admin) => admin.email);

        const apiBaseUrl = process.env.API_BASE_URL;
        const acceptUrl = `${apiBaseUrl}/leave/accept/${leaveId.split("#")[1]}`;
        const rejectUrl = `${apiBaseUrl}/leave/reject/${leaveId.split("#")[1]}`;

        const htmlBody = `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  line-height: 1.6;
                  color: #333;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                  border: 1px solid #ddd;
                  border-radius: 8px;
                }
                .header {
                  background-color: #f8f9fa;
                  padding: 15px;
                  border-radius: 5px;
                  margin-bottom: 20px;
                }
                .content {
                  margin: 20px 0;
                }
                .button-group {
                  display: flex;
                  gap: 15px;
                  margin-top: 30px;
                  justify-content: center;
                }
                .btn {
                  display: inline-block;
                  padding: 12px 30px;
                  border-radius: 5px;
                  text-decoration: none;
                  font-weight: bold;
                  cursor: pointer;
                  font-size: 16px;
                }
                .btn-accept {
                  background-color: #28a745;
                  color: white;
                }
                .btn-accept:hover {
                  background-color: #218838;
                }
                .btn-reject {
                  background-color: #dc3545;
                  color: white;
                }
                .btn-reject:hover {
                  background-color: #c82333;
                }
                .footer {
                  margin-top: 30px;
                  font-size: 12px;
                  color: #666;
                  border-top: 1px solid #ddd;
                  padding-top: 15px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h2>New Leave Application Submitted</h2>
                </div>
                
                <div class="content">
                  <p>A new leave application has been submitted by <strong>${applicantName}</strong> (${applicantId}).</p>
                  
                  <p><strong>Leave Details:</strong></p>
                  <ul>
                    <li>From: ${fromDate}</li>
                    <li>To: ${toDate}</li>
                  </ul>
                  
                  <p>Please review the application and take action below:</p>
                </div>
                
                <div class="button-group">
                  <a href="${acceptUrl}" class="btn btn-accept">Accept</a>
                  <a href="${rejectUrl}" class="btn btn-reject">Reject</a>
                </div>
                
                <div class="footer">
                  <p>This is an automated message. Please do not reply to this email.</p>
                </div>
              </div>
            </body>
          </html>
        `;

        const plainTextBody = `A new leave application has been submitted by ${applicantName} (${applicantId}) for the period from ${fromDate} to ${toDate}. Please review the application at your earliest convenience.`;

        await sendEmailNotification({
          sender: process.env.SENDER_EMAIL!,
          subject: "New Leave Application Submitted",
          recipients: adminEmails,
          bodyText: plainTextBody,
          bodyHtml: htmlBody,
        });

        // Put the "task_token" into LEAVE_TABLE against each leave_id item
        updateLeaveCommand = new UpdateCommand({
          TableName: process.env.LEAVE_TABLE_NAME!,
          Key: {
            leaveId,
          },
          UpdateExpression: "SET task_token = :tt",
          ExpressionAttributeValues: {
            ":tt": event["task_token"],
          },
        });

        // No result (Since this "wait_for_callback")
        result = new NotificationResult(true, "Admin notifications sent", {
          adminNotified: adminEmails.length,
          admins: adminEmails,
          applicantId,
          applicantName,
          fromDate,
          toDate,
        });

        break;
      }
      case "ACCEPT": {
        await sendEmailNotification({
          sender: process.env.SENDER_EMAIL!,
          subject: "Leave Application Accepted",
          recipients: [applicantId],
          bodyText: `Your leave application submitted by ${applicantName} (${applicantId}) for the period from ${fromDate} to ${toDate} has been accepted.`,
        });

        updateLeaveCommand = new UpdateCommand({
          TableName: process.env.LEAVE_TABLE_NAME!,
          Key: {
            leaveId,
          },
          UpdateExpression: "REMOVE task_token SET #status = :accepted",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":accepted": "ACCEPTED",
          },
        });

        result = new NotificationResult(
          true,
          "Applicant notified of acceptance",
          {
            applicantId,
            applicantName,
            fromDate,
            toDate,
          }
        );

        break;
      }
      case "REJECT": {
        await sendEmailNotification({
          sender: process.env.SENDER_EMAIL!,
          subject: "Leave Application Rejected",
          recipients: [applicantId],
          bodyText: `Your leave application submitted by ${applicantName} (${applicantId}) for the period from ${fromDate} to ${toDate} has been rejected.`,
        });

        result = new NotificationResult(
          true,
          "Applicant notified of rejection",
          {
            applicantId,
            applicantName,
            fromDate,
            toDate,
          }
        );

        updateLeaveCommand = new UpdateCommand({
          TableName: process.env.LEAVE_TABLE_NAME!,
          Key: {
            leaveId,
          },
          UpdateExpression: "REMOVE task_token SET #status = :accepted",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":accepted": "REJECTED",
          },
        });

        break;
      }
      default:
        throw getErrorObj("InvalidEvent", `Unknown event type: ${type}`);
    }

    // Updating the leave item with the constructed command
    await docClient.send(updateLeaveCommand);

    return result;
  } catch (error) {
    console.error("Error in notify_users handler:", error);
    if (
      error instanceof Error &&
      ["InvalidEvent", "MissingTaskToken", "NoAdminsFound"].includes(error.name)
    ) {
      throw error;
    }
    throw getErrorObj("NotificationError", "Failed to send notifications");
  }
};
