# Contest Scheduler REST API Documentation

This document outlines the REST API endpoints for managing contest schedules in DegenDuel. The API is divided into two parts:

1. Admin API - For managing schedules (CRUD operations)
2. Public API - For retrieving schedule information

## Admin API Endpoints

All admin endpoints require admin authentication and are available under the `/api/admin/contest-scheduler` base path.

### Get Scheduler Status

- **URL**: `GET /api/admin/contest-scheduler/status`
- **Description**: Get the current status of the contest scheduler service
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "isRunning": true,
      "stats": {
        "contests": {
          "created": 24,
          "createdDuringMaintenance": 0,
          "createdFromDatabaseSchedules": 12
        }
      },
      "config": {
        "contests": {
          "schedules": [
            /* Array of schedule objects */
          ]
        }
      },
      "health": {
        "status": "healthy",
        "circuitBreaker": {
          "isOpen": false,
          "failureCount": 0
        }
      },
      "maintenance": {
        "systemInMaintenanceMode": false
      }
    }
  }
  ```

### Control Service

- **URL**: `POST /api/admin/contest-scheduler/control/:action`
- **Description**: Control the contest scheduler service state
- **Parameters**:
  - `:action` - One of: `start`, `stop`, `restart`, `status`
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "message": "Service start completed successfully",
    "status": {
      "isRunning": true,
      "health": {
        "status": "healthy",
        "circuitBreaker": {
          "isOpen": false,
          "failureCount": 0
        }
      }
    }
  }
  ```

### Get Configuration File

- **URL**: `GET /api/admin/contest-scheduler/config-file`
- **Description**: Get the raw configuration from the config file
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "configFile": {
        "contests": {
          "schedules": [
            /* Array of schedule objects */
          ]
        }
      }
    }
  }
  ```

### Update Configuration

- **URL**: `PUT /api/admin/contest-scheduler/config`
- **Description**: Update the contest scheduler configuration
- **Authentication**: Admin required
- **Request Body**:
  ```json
  {
    "configuration": {
      "contests": {
        "schedules": [
          /* Array of schedule objects */
        ]
      }
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Contest scheduler configuration updated",
    "data": {
      "config": {
        "contests": {
          "schedules": [
            /* Array of schedule objects */
          ]
        }
      }
    }
  }
  ```

### Create Contest Now (from Config)

- **URL**: `POST /api/admin/contest-scheduler/create-contest`
- **Description**: Create a contest immediately based on a named schedule from config
- **Authentication**: Admin required
- **Request Body**:
  ```json
  {
    "scheduleName": "daily-contest"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Contest created successfully",
    "data": {
      "contest": {
        "id": 101,
        "name": "Daily Contest #101",
        "contest_code": "DC101",
        "start_time": "2025-04-27T14:00:00.000Z",
        "end_time": "2025-04-27T15:30:00.000Z",
        "entry_fee": "1.00",
        "status": "pending"
      },
      "wallet": {
        "address": "5xyzABCD..."
      }
    }
  }
  ```

### Get All Database Schedules

- **URL**: `GET /api/admin/contest-scheduler/db-schedules`
- **Description**: Get all schedules from the database
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "name": "Daily Contest",
        "template_id": 1,
        "hour": 14,
        "minute": 0,
        "days": [1, 2, 3, 4, 5],
        "duration_hours": 1.5,
        "enabled": true,
        "template": {
          "id": 1,
          "name": "Standard Contest",
          "description": "Standard daily trading contest"
        }
      }
    ]
  }
  ```

### Get Schedule by ID

- **URL**: `GET /api/admin/contest-scheduler/db-schedules/:id`
- **Description**: Get a single schedule by ID
- **Parameters**:
  - `:id` - The schedule ID (integer)
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "id": 1,
      "name": "Daily Contest",
      "template_id": 1,
      "hour": 14,
      "minute": 0,
      "days": [1, 2, 3, 4, 5],
      "duration_hours": 1.5,
      "enabled": true,
      "template": {
        "id": 1,
        "name": "Standard Contest",
        "description": "Standard daily trading contest"
      },
      "contests": [
        {
          "id": 101,
          "name": "Daily Contest #101",
          "start_time": "2025-04-27T14:00:00.000Z",
          "end_time": "2025-04-27T15:30:00.000Z"
        }
      ]
    }
  }
  ```

### Create Schedule

- **URL**: `POST /api/admin/contest-scheduler/db-schedules`
- **Description**: Create a new schedule in the database
- **Authentication**: Admin required
- **Request Body**:
  ```json
  {
    "name": "Daily Contest",
    "template_id": 1,
    "hour": 14,
    "minute": 0,
    "days": [1, 2, 3, 4, 5],
    "entry_fee_override": "1.00",
    "duration_hours": 1.5,
    "enabled": true,
    "advance_notice_hours": 1,
    "allow_multiple_hours": false
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Schedule created successfully",
    "data": {
      "id": 1,
      "name": "Daily Contest",
      "template_id": 1,
      "hour": 14,
      "minute": 0,
      "days": [1, 2, 3, 4, 5],
      "duration_hours": 1.5,
      "enabled": true
    }
  }
  ```

### Update Schedule

- **URL**: `PUT /api/admin/contest-scheduler/db-schedules/:id`
- **Description**: Update an existing schedule in the database
- **Parameters**:
  - `:id` - The schedule ID (integer)
- **Authentication**: Admin required
- **Request Body**:
  ```json
  {
    "name": "Updated Daily Contest",
    "hour": 15,
    "days": [1, 3, 5]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Schedule updated successfully",
    "data": {
      "id": 1,
      "name": "Updated Daily Contest",
      "template_id": 1,
      "hour": 15,
      "minute": 0,
      "days": [1, 3, 5],
      "duration_hours": 1.5,
      "enabled": true
    }
  }
  ```

### Delete Schedule

- **URL**: `DELETE /api/admin/contest-scheduler/db-schedules/:id`
- **Description**: Delete a schedule from the database (only if it has no upcoming contests)
- **Parameters**:
  - `:id` - The schedule ID (integer)
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "message": "Schedule deleted successfully"
  }
  ```

### Get Templates

- **URL**: `GET /api/admin/contest-scheduler/templates`
- **Description**: Get all available contest templates
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "name": "Standard Contest",
        "description": "Standard daily trading contest",
        "entry_fee": "1.00",
        "min_participants": 2,
        "max_participants": 50
      }
    ]
  }
  ```

### Create Contest Now (from Database)

- **URL**: `POST /api/admin/contest-scheduler/create-db-contest`
- **Description**: Create a contest immediately based on a database schedule
- **Authentication**: Admin required
- **Request Body**:
  ```json
  {
    "scheduleId": 1
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Contest created successfully",
    "data": {
      "contest": {
        "id": 101,
        "name": "Daily Contest #101",
        "contest_code": "DC101",
        "start_time": "2025-04-27T14:00:00.000Z",
        "end_time": "2025-04-27T15:30:00.000Z",
        "entry_fee": "1.00",
        "status": "pending"
      },
      "schedule": {
        "id": 1,
        "name": "Daily Contest"
      },
      "wallet": {
        "address": "5xyzABCD..."
      }
    }
  }
  ```

### Migrate Config to Database

- **URL**: `POST /api/admin/contest-scheduler/migrate-config`
- **Description**: Migrate configuration-based schedules to the database
- **Authentication**: Admin required
- **Response**:
  ```json
  {
    "success": true,
    "message": "Successfully migrated config schedules to database",
    "data": {
      "schedules": [
        /* Array of schedule objects */
      ]
    }
  }
  ```

## Public API Endpoints

These endpoints are available to all users for retrieving contest schedule information.

### Get All Public Schedules

- **URL**: `GET /api/contests/schedules`
- **Description**: Get all active contest schedules with upcoming contests
- **Authentication**: None (public endpoint)
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "name": "Daily Contest",
        "days": [1, 2, 3, 4, 5],
        "hour": 14,
        "minute": 0,
        "duration_hours": 1.5,
        "entry_fee": "1.00",
        "upcoming_contests": [
          {
            "id": 101,
            "name": "Daily Contest #101",
            "start_time": "2025-04-27T14:00:00.000Z",
            "end_time": "2025-04-27T15:30:00.000Z",
            "entry_fee": "1.00",
            "prize_pool": "100.00",
            "status": "pending"
          }
        ],
        "allow_multiple_hours": false,
        "multiple_hours": []
      }
    ]
  }
  ```

### Get Schedule by ID

- **URL**: `GET /api/contests/schedules/:id`
- **Description**: Get a specific contest schedule with its upcoming contests
- **Parameters**:
  - `:id` - The schedule ID (integer)
- **Authentication**: None (public endpoint)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "id": 1,
      "name": "Daily Contest",
      "template": {
        "id": 1,
        "name": "Standard Contest",
        "description": "Standard daily trading contest",
        "entry_fee": "1.00",
        "min_participants": 2,
        "max_participants": 50
      },
      "days": [1, 2, 3, 4, 5],
      "hour": 14,
      "minute": 0,
      "duration_hours": 1.5,
      "entry_fee": "1.00",
      "allow_multiple_hours": false,
      "multiple_hours": [],
      "upcoming_contests": [
        {
          "id": 101,
          "name": "Daily Contest #101",
          "start_time": "2025-04-27T14:00:00.000Z",
          "end_time": "2025-04-27T15:30:00.000Z",
          "entry_fee": "1.00",
          "prize_pool": "100.00",
          "status": "pending"
        }
      ]
    }
  }
  ```

## Frontend Integration Guide

To integrate the contest schedule API with the frontend:

1. **Display All Schedules**:
   - Use `GET /api/contests/schedules` to fetch all active schedules
   - Display schedules in a list or calendar view
   - Show schedule days, times, and upcoming contests

2. **Show Schedule Details**:
   - Use `GET /api/contests/schedules/:id` to fetch details about a specific schedule
   - Display information about the schedule template, timing, and entry fee
   - Show a list of upcoming contests for this schedule

3. **Schedule Calendar Integration**:
   - Use schedule data to populate a calendar view
   - Parse the `days` array to determine which days of the week the schedule is active
   - Use `hour` and `minute` to determine the time of day for contests

4. **Contest Entry Flow**:
   - When a user wants to enter a contest, direct them to the appropriate contest entry page
   - Use upcoming_contests data to provide direct links to specific contests

5. **Admin Management Interface**:
   - Build an admin interface using the admin API endpoints
   - Provide CRUD operations for schedules (create, read, update, delete)
   - Add the ability to manually trigger contests or migrate config

## Webhook Integration (Future)

For future development, webhook integration could be added to notify external systems about:

- Schedule changes
- Contest creation
- Contest state changes (pending → active → completed)

This would allow for better integration with external systems such as Discord notifications, marketing tools, or analytics platforms.