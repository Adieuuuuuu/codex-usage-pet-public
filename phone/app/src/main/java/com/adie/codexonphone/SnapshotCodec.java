package com.adie.codexonphone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class SnapshotCodec {
    private static final int MAX_TASKS = 10;
    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_TITLE_LENGTH = 160;
    private static final int MAX_WORKSPACE_LENGTH = 120;

    private SnapshotCodec() {
    }

    public static CodexSnapshot decode(String json, boolean tasksHidden) {
        try {
            JSONObject root = new JSONObject(json);
            int version = root.getInt("version");
            long sequence = root.getLong("sequence");
            long capturedAt = root.getLong("capturedAt");
            if (version != 1 || sequence <= 0 || capturedAt <= 0) {
                throw invalid("Invalid snapshot header.");
            }

            JSONObject usageJson = root.getJSONObject("usage");
            CodexSnapshot.UsageStatus usageStatus =
                    parseUsageStatus(usageJson.getString("status"));
            Integer remainingPercent = null;
            Long resetsAt = null;
            if (usageStatus != CodexSnapshot.UsageStatus.UNAVAILABLE) {
                remainingPercent = usageJson.getInt("remainingPercent");
                resetsAt = usageJson.getLong("resetsAt");
                if (remainingPercent < 0
                        || remainingPercent > 100
                        || resetsAt <= 0) {
                    throw invalid("Usage values are out of range.");
                }
            }

            JSONArray tasksJson = root.getJSONArray("tasks");
            if (tasksJson.length() > MAX_TASKS) {
                throw invalid("Too many tasks.");
            }
            List<CodexSnapshot.Task> tasks = new ArrayList<>();
            for (int index = 0; index < tasksJson.length(); index++) {
                JSONObject task = tasksJson.getJSONObject(index);
                String id = bounded(task.getString("id"), MAX_ID_LENGTH, "id");
                String title =
                        bounded(task.getString("title"), MAX_TITLE_LENGTH, "title");
                String workspace = null;
                if (!task.isNull("workspaceName")) {
                    workspace = bounded(
                            task.getString("workspaceName"),
                            MAX_WORKSPACE_LENGTH,
                            "workspaceName"
                    );
                }
                CodexSnapshot.TaskStatus status =
                        parseTaskStatus(task.getString("status"));
                long updatedAt = task.getLong("updatedAt");
                if (updatedAt <= 0) {
                    throw invalid("Task timestamp is invalid.");
                }
                tasks.add(new CodexSnapshot.Task(
                        id,
                        title,
                        workspace,
                        status,
                        updatedAt
                ));
            }

            return new CodexSnapshot(
                    version,
                    sequence,
                    capturedAt,
                    usageStatus,
                    remainingPercent,
                    resetsAt,
                    tasks,
                    tasksHidden
            );
        } catch (JSONException error) {
            throw invalid("Malformed snapshot JSON.", error);
        }
    }

    public static String encode(CodexSnapshot snapshot) {
        try {
            JSONObject usage = new JSONObject()
                    .put("status", usageStatusName(snapshot.usageStatus()));
            if (snapshot.usageStatus()
                    != CodexSnapshot.UsageStatus.UNAVAILABLE) {
                usage.put("remainingPercent", snapshot.remainingPercent());
                usage.put("resetsAt", snapshot.resetsAt());
            }
            JSONArray tasks = new JSONArray();
            for (CodexSnapshot.Task task : snapshot.tasks()) {
                tasks.put(new JSONObject()
                        .put("id", task.id())
                        .put("title", task.title())
                        .put("workspaceName", task.workspaceName())
                        .put("status", taskStatusName(task.status()))
                        .put("updatedAt", task.updatedAt()));
            }
            return new JSONObject()
                    .put("version", snapshot.version())
                    .put("sequence", snapshot.sequence())
                    .put("capturedAt", snapshot.capturedAt())
                    .put("usage", usage)
                    .put("tasks", tasks)
                    .toString();
        } catch (JSONException error) {
            throw new IllegalStateException("Snapshot serialization failed.", error);
        }
    }

    private static CodexSnapshot.UsageStatus parseUsageStatus(String value) {
        switch (value) {
            case "available":
                return CodexSnapshot.UsageStatus.AVAILABLE;
            case "unavailable":
                return CodexSnapshot.UsageStatus.UNAVAILABLE;
            case "stale":
                return CodexSnapshot.UsageStatus.STALE;
            default:
                throw invalid("Unknown usage status.");
        }
    }

    private static CodexSnapshot.TaskStatus parseTaskStatus(String value) {
        switch (value) {
            case "running":
                return CodexSnapshot.TaskStatus.RUNNING;
            case "waiting":
                return CodexSnapshot.TaskStatus.WAITING;
            case "review":
                return CodexSnapshot.TaskStatus.REVIEW;
            case "failed":
                return CodexSnapshot.TaskStatus.FAILED;
            default:
                throw invalid("Unknown task status.");
        }
    }

    private static String usageStatusName(CodexSnapshot.UsageStatus status) {
        return status.name().toLowerCase(java.util.Locale.ROOT);
    }

    private static String taskStatusName(CodexSnapshot.TaskStatus status) {
        return status.name().toLowerCase(java.util.Locale.ROOT);
    }

    private static String bounded(String value, int maximum, String field) {
        String normalized = value.trim();
        if (normalized.isEmpty() || normalized.length() > maximum) {
            throw invalid("Invalid " + field + " length.");
        }
        return normalized;
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }

    private static IllegalArgumentException invalid(
            String message,
            Throwable cause
    ) {
        return new IllegalArgumentException(message, cause);
    }
}
