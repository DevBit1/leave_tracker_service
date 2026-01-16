import { createHash } from "node:crypto";

export const getLeaveId = (
  applicantId: string,
  fromDate: Date,
  toDate: Date
) => {
  const hash = createHash("sha256");
  hash.update(`${applicantId}-${fromDate.getTime()}-${toDate.getTime()}`);
  return `LEAVE#${hash.digest("base64url")}`;
};

export class Leave {
  leaveId: string; // Primary Key
  fromDate: string;
  toDate: string;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  appliedOn: string;
  reviewedOn?: string;
  reviewerName?: string;
  reviewerId?: string;
  applicantId: string;
  applicantName: string;

  constructor(params: {
    fromDate: string;
    toDate: string;
    reason?: string;
    applicantId: string;
    applicantName: string;
  }) {
    this.leaveId = getLeaveId(
      params.applicantId,
      new Date(params.fromDate),
      new Date(params.toDate)
    );
    this.fromDate = params.fromDate;
    this.toDate = params.toDate;
    this.reason = params.reason;
    this.status = "PENDING";
    this.appliedOn = new Date().toISOString();
    this.applicantId = params.applicantId;
    this.applicantName = params.applicantName;
  }
}

export interface Response {
  statusCode: number;
  body: string;
}

export class ResponseObj implements Response {
  statusCode: number;
  body: string;

  constructor(statusCode: number, body: Record<string, any>) {
    this.statusCode = statusCode;
    this.body = JSON.stringify(body);
  }
}
