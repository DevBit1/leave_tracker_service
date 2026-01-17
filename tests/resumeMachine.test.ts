import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  SFNClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
} from "@aws-sdk/client-sfn";
import { APIGatewayEvent } from "aws-lambda";
import { handler } from "../src/functions/resume_machine";

const ddbMock = mockClient(DynamoDBDocumentClient);
const sfnMock = mockClient(SFNClient);

describe("Resume Machine Handler", () => {
  beforeEach(() => {
    ddbMock.reset();
    sfnMock.reset();
    jest.clearAllMocks();

    process.env.LEAVE_TABLE_NAME = "test-leave-table";

    ddbMock.on(GetCommand).resolves({
      Item: {
        leaveId: "LEAVE#test-leave-id",
        status: "PENDING",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
        task_token: "test-task-token-123",
      },
    });

    sfnMock.on(SendTaskSuccessCommand).resolves({});
    sfnMock.on(SendTaskFailureCommand).resolves({});
  });

  afterAll(() => {
    delete process.env.LEAVE_TABLE_NAME;
  });

  test("should accept leave and send task success", async () => {
    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Leave accepted successfully");

    // Verify GetCommand was called
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    const getCall = ddbMock.commandCalls(GetCommand)[0];
    expect(getCall.args[0].input.Key?.leaveId).toBe("LEAVE#test-leave-id");

    // Verify SendTaskSuccessCommand was called
    expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(1);
    const sfnCall = sfnMock.commandCalls(SendTaskSuccessCommand)[0];
    expect(sfnCall.args[0].input.taskToken).toBe("test-task-token-123");

    const output = JSON.parse(sfnCall.args[0].input.output || "{}");
    expect(output.type).toBe("ACCEPT");
    expect(output.applicantId).toBe("user@example.com");
    expect(output.applicantName).toBe("Test User");

    // Verify SendTaskFailureCommand was NOT called
    expect(sfnMock.commandCalls(SendTaskFailureCommand)).toHaveLength(0);
  });

  test("should reject leave and send task success", async () => {
    const event = {
      path: "/leave/reject/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Leave rejected successfully");

    // Verify SendTaskSuccessCommand was called with REJECT type
    expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(1);
    const sfnCall = sfnMock.commandCalls(SendTaskSuccessCommand)[0];
    expect(sfnCall.args[0].input.taskToken).toBe("test-task-token-123");

    const output = JSON.parse(sfnCall.args[0].input.output || "{}");
    expect(output.type).toBe("REJECT");
    expect(output.applicantId).toBe("user@example.com");
  });

  test("should return 500 when pathParameters is missing", async () => {
    const event = {
      path: "/leave/accept/test-leave-id",
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("Missing leaveId in path parameters");
  });

  test("should return 500 when leaveId is missing in pathParameters", async () => {
    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {},
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("Missing leaveId in path parameters");
  });

  test("should return 500 when leave is not found", async () => {
    ddbMock.on(GetCommand).resolves({});

    const event = {
      path: "/leave/accept/non-existent-id",
      pathParameters: {
        leaveId: "non-existent-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain(
      "Leave with ID LEAVE#non-existent-id not found"
    );
  });

  test("should return 400 when leave status is not PENDING", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        leaveId: "LEAVE#test-leave-id",
        status: "APPROVED",
        applicantId: "user@example.com",
        applicantName: "Test User",
        fromDate: "2026-12-01",
        toDate: "2026-12-05",
        task_token: "test-task-token-123",
      },
    });

    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain(
      "Leave with ID LEAVE#test-leave-id has been already processed"
    );
    expect(body.message).toContain("APPROVED");

    // Should NOT call Step Functions
    expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
    expect(sfnMock.commandCalls(SendTaskFailureCommand)).toHaveLength(0);
  });

  test("should return 400 when leave status is REJECTED", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        leaveId: "LEAVE#test-leave-id",
        status: "REJECTED",
        applicantId: "user@example.com",
        task_token: "test-task-token-123",
      },
    });

    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("REJECTED");
  });

  test("should return 400 and send task failure for invalid action", async () => {
    const event = {
      path: "/leave/invalid/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe(
      "Invalid action: invalid. Expected ACCEPT or REJECT."
    );

    // Verify SendTaskFailureCommand was called
    expect(sfnMock.commandCalls(SendTaskFailureCommand)).toHaveLength(1);
    const sfnCall = sfnMock.commandCalls(SendTaskFailureCommand)[0];
    expect(sfnCall.args[0].input.taskToken).toBe("test-task-token-123");
    expect(sfnCall.args[0].input.error).toBe("InvalidAction");
    expect(sfnCall.args[0].input.cause).toContain(
      "The action invalid is not valid"
    );

    // Verify SendTaskSuccessCommand was NOT called
    expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  test("should handle path with multiple segments correctly (accept)", async () => {
    const event = {
      path: "/api/v1/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Leave accepted successfully");
  });

  test("should handle path with multiple segments correctly (reject)", async () => {
    const event = {
      path: "/api/v1/leave/reject/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Leave rejected successfully");
  });

  test("should return 500 when DynamoDB GetCommand fails", async () => {
    ddbMock.on(GetCommand).rejects(new Error("DynamoDB error"));

    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("DynamoDB error");
  });

  test("should return 500 when SendTaskSuccessCommand fails for accept", async () => {
    sfnMock
      .on(SendTaskSuccessCommand)
      .rejects(new Error("Step Functions error"));

    const event = {
      path: "/leave/accept/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("Step Functions error");
  });

  test("should return 500 when SendTaskSuccessCommand fails for reject", async () => {
    sfnMock
      .on(SendTaskSuccessCommand)
      .rejects(new Error("Step Functions error"));

    const event = {
      path: "/leave/reject/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("Step Functions error");
  });

  test("should return 500 when SendTaskFailureCommand fails", async () => {
    sfnMock
      .on(SendTaskFailureCommand)
      .rejects(new Error("Step Functions error"));

    const event = {
      path: "/leave/invalid/test-leave-id",
      pathParameters: {
        leaveId: "test-leave-id",
      },
    } as Partial<APIGatewayEvent> as APIGatewayEvent;

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
    expect(body.error).toContain("Step Functions error");
  });
});
