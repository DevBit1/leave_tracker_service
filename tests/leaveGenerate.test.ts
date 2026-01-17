import { mockClient } from "aws-sdk-client-mock";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../src/functions/leave_generate";

const sfnMock = mockClient(SFNClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

describe("Leave Generate Handler", () => {
  beforeEach(() => {
    sfnMock.reset();
    ddbMock.reset();
    jest.clearAllMocks();

    process.env.LEAVE_TABLE_NAME = "test-leave-table";
    process.env.LEAVE_PROCESSING_STATE_MACHINE_ARN = "arn:aws:states:us-east-1:123456789012:stateMachine:test";

    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    sfnMock.on(StartExecutionCommand).resolves({
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:test",
      startDate: new Date(),
    });
  });

  afterAll(() => {
    delete process.env.LEAVE_TABLE_NAME;
    delete process.env.LEAVE_PROCESSING_STATE_MACHINE_ARN;
  });

  test("should create leave application successfully with full day leave", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
        reason: "Vacation",
      }),
      requestContext: {
        authorizer: {
          userId: "test@example.com",
          userName: "Test User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.message).toBe("Leave application submitted");
    expect(body.leaveObj.applicantId).toBe("test@example.com");
    expect(body.leaveObj.applicantName).toBe("Test User");
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(1);
  });

  test("should create leave with specific times", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-01",
        fromTime: "09:00",
        toTime: "17:00",
        reason: "Half day",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    console.log(result);
    expect(result.statusCode).toBe(201);
  });

  test("should create leave with fromTime only", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-02",
        fromTime: "14:00",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(201);
  });

  test("should create leave with toTime only", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-02",
        toTime: "12:00",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(201);
  });

  test("should create leave with empty reason (default)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body.leaveObj.reason).toBe("");
  });

  test("should create leave when existing leave is not PENDING", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        leaveId: "existing-id",
        status: "APPROVED",
      },
    });

    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
        reason: "New leave",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(201);
  });

  test("should return 400 when body is missing", async () => {
    const event = {
      body: null,
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("Invalid request body");
  });

  test("should return 400 when body is not a string", async () => {
    const event = {
      body: {},
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("Invalid request body");
  });

  test("should return 400 when 'from' is missing", async () => {
    const event = {
      body: JSON.stringify({
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("from and to are required");
  });

  test("should return 400 when 'to' is missing", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("from and to are required");
  });

  test("should return 400 when date format is invalid", async () => {
    const event = {
      body: JSON.stringify({
        from: "invalid-date",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("Invalid date format");
  });

  test("should return 400 when fromTime format is invalid", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
        fromTime: "25:00",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("Invalid fromTime format");
  });

  test("should return 400 when toTime format is invalid", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
        toTime: "invalid",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("Invalid toTime format");
  });

  test("should return 400 when from date is later than to date", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-10",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date cannot be later than to date");
  });

  test("should return 400 when from date is later than to date (with time - only fromTime)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-06",
        to: "2026-12-05",
        fromTime: "00:01"
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date and time cannot be later than to date");
  });

  test("should return 400 when from date is later than to date (with time - only toTime)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-06",
        to: "2026-12-05",
        toTime: "05:00"
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date cannot be later than to date and time");
  });

  test("should return 400 when from date is later than to date (with time)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-05",
        to: "2026-12-05",
        fromTime: "16:00",
        toTime: "13:00"
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date and time cannot be later than to date");
  });

  test("should return 400 when from date is older than current time (without time)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-01-15",
        to: "2026-01-18",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date and time cannot be in the past");
  });

  test("should return 400 when from date is older than current time (with time)", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-01-17",
        to: "2026-01-18",
        fromTime: "09:00"
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toContain("from date and time cannot be in the past");
  });

  test("should return 400 when userId is missing", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("Unauthorized entity");
  });

  test("should return 400 when userName is missing", async () => {
    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.message).toBe("Unauthorized entity");
  });

  test("should return 409 when PENDING leave already exists", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        leaveId: "existing-id",
        status: "PENDING",
      },
    });

    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(409);
    expect(body.message).toBe("There is already a leave application for the given dates");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
  });

  test("should return 500 when DynamoDB GetCommand fails", async () => {
    ddbMock.on(GetCommand).rejects(new Error("DynamoDB error"));

    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
  });

  test("should return 500 when DynamoDB PutCommand fails", async () => {
    ddbMock.on(PutCommand).rejects(new Error("DynamoDB error"));

    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
  });

  test("should return 500 when Step Functions fails", async () => {
    sfnMock.on(StartExecutionCommand).rejects(new Error("Step Functions error"));

    const event = {
      body: JSON.stringify({
        from: "2026-12-01",
        to: "2026-12-05",
      }),
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
  });

  test("should return 500 when JSON.parse fails", async () => {
    const event = {
      body: "{ invalid json",
      requestContext: {
        authorizer: {
          userId: "user@test.com",
          userName: "User",
        },
      },
    };

    const result = await handler(event as any);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(500);
    expect(body.message).toBe("Internal server error");
  });
});