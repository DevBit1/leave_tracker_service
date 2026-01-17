import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { EventObj, handler } from "../src/functions/notify_users";

const ddbMock = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

describe("Notify Users Handler", () => {
  beforeEach(() => {
    ddbMock.reset();
    sesMock.reset();
    jest.clearAllMocks();

    process.env.USER_TABLE_NAME = "test-user-table";
    process.env.USER_GSI_NAME = "role-index";
    process.env.LEAVE_TABLE_NAME = "test-leave-table";
    process.env.SENDER_EMAIL = "noreply@example.com";
    process.env.API_BASE_URL = "https://api.example.com";

    ddbMock.on(QueryCommand).resolves({
      Items: [
        { email: "admin1@example.com", role: "ADMIN" },
        { email: "admin2@example.com", role: "ADMIN" },
      ],
    });

    ddbMock.on(UpdateCommand).resolves({});

    sesMock.on(SendEmailCommand).resolves({
      MessageId: "test-message-id",
    });
  });

  afterAll(() => {
    delete process.env.USER_TABLE_NAME;
    delete process.env.USER_GSI_NAME;
    delete process.env.LEAVE_TABLE_NAME;
    delete process.env.SENDER_EMAIL;
    delete process.env.API_BASE_URL;
  });

  test("should handle REQUEST type and notify admins", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-task-token-123",
    };

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Admin notifications sent");
    expect(result.adminNotified).toBe(2);
    expect(result.admins).toEqual(["admin1@example.com", "admin2@example.com"]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    const queryCall = ddbMock.commandCalls(QueryCommand)[0];
    expect(queryCall.args[0].input.IndexName).toBe("role-index");
    expect(queryCall.args[0].input.ExpressionAttributeValues?.[":admin"]).toBe(
      "ADMIN"
    );

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const sesCall = sesMock.commandCalls(SendEmailCommand)[0];
    expect(sesCall.args[0].input.Destination?.ToAddresses).toEqual([
      "admin1@example.com",
      "admin2@example.com",
    ]);
    expect(sesCall.args[0].input.Message?.Subject?.Data).toBe(
      "New Leave Application Submitted"
    );

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
    expect(updateCall.args[0].input.ExpressionAttributeValues?.[":tt"]).toBe(
      "test-task-token-123"
    );
  });

  test("should handle ACCEPT type and notify applicant", async () => {
    const event: EventObj = {
      input: {
        type: "ACCEPT",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Applicant notified of acceptance");
    expect(result.applicantId).toBe("user@example.com");

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const sesCall = sesMock.commandCalls(SendEmailCommand)[0];
    expect(sesCall.args[0].input.Destination?.ToAddresses).toEqual([
      "user@example.com",
    ]);
    expect(sesCall.args[0].input.Message?.Subject?.Data).toBe(
      "Leave Application Accepted"
    );

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
    expect(updateCall.args[0].input.UpdateExpression).toContain(
      "REMOVE task_token"
    );
    expect(
      updateCall.args[0].input.ExpressionAttributeValues?.[":accepted"]
    ).toBe("ACCEPTED");

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("should handle REJECT type and notify applicant", async () => {
    const event: EventObj = {
      input: {
        type: "REJECT",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Applicant notified of rejection");
    expect(result.applicantId).toBe("user@example.com");

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const sesCall = sesMock.commandCalls(SendEmailCommand)[0];
    expect(sesCall.args[0].input.Destination?.ToAddresses).toEqual([
      "user@example.com",
    ]);
    expect(sesCall.args[0].input.Message?.Subject?.Data).toBe(
      "Leave Application Rejected"
    );

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
    expect(updateCall.args[0].input.UpdateExpression).toContain(
      "REMOVE task_token"
    );
    expect(
      updateCall.args[0].input.ExpressionAttributeValues?.[":accepted"]
    ).toBe("REJECTED");

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("should handle case-insensitive event type (lowercase)", async () => {
    const event = {
      input: {
        type: "accept" as const, // lowercase
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    const result = await handler(event as unknown as EventObj);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Applicant notified of acceptance");
  });

  test("should handle case-insensitive event type (mixed case)", async () => {
    const event = {
      input: {
        type: "ReJeCt" as const,
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    const result = await handler(event as unknown as EventObj);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Applicant notified of rejection");
  });

  test("should throw error when type is missing", async () => {
    const event = {
      input: {
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    await expect(handler(event as EventObj)).rejects.toThrow(
      "Event type is required"
    );
  });

  test("should throw error when applicantId is missing", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Missing required fields for leave request"
    );
  });

  test("should throw error when applicantName is missing", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Missing required fields for leave request"
    );
  });

  test("should throw error when fromDate is missing", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Missing required fields for leave request"
    );
  });

  test("should throw error when toDate is missing", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Missing required fields for leave request"
    );
  });

  test("should throw error when task_token is missing for REQUEST type", async () => {
    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    await expect(handler(event)).rejects.toThrow(
      "Task token is required for REQUEST type"
    );
  });

  test("should throw error for unknown event type", async () => {
    const event = {
      input: {
        type: "INVALID_TYPE" as "REQUEST" | "ACCEPT" | "REJECT",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    await expect(handler(event as EventObj)).rejects.toThrow(
      "Unknown event type: INVALID_TYPE"
    );
  });

  test("should throw error when no admins found for REQUEST type", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: undefined,
    });

    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow("No administrators found");
  });

  test("should throw error when admins list is empty for REQUEST type", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [],
    });

    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow("No administrators found");
  });

  test("should throw error when DynamoDB QueryCommand fails", async () => {
    ddbMock.on(QueryCommand).rejects(new Error("DynamoDB error"));

    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Failed to send notifications"
    );
  });

  test("should throw error when SES SendEmailCommand fails", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("SES error"));

    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Failed to send notifications"
    );
  });

  test("should throw error when DynamoDB UpdateCommand fails", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("Update failed"));

    const event: EventObj = {
      input: {
        type: "REQUEST",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
      task_token: "test-token",
    };

    await expect(handler(event)).rejects.toThrow(
      "Failed to send notifications"
    );
  });

  test("should throw error when SES fails for ACCEPT type", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("SES error"));

    const event: EventObj = {
      input: {
        type: "ACCEPT",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    await expect(handler(event)).rejects.toThrow(
      "Failed to send notifications"
    );
  });

  test("should throw error when UpdateCommand fails for REJECT type", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("Update failed"));

    const event: EventObj = {
      input: {
        type: "REJECT",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
      },
    };

    await expect(handler(event)).rejects.toThrow(
      "Failed to send notifications"
    );
  });
});
