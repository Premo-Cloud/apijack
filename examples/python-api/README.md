# Bookstore API

A simple FastAPI REST API used as a test target for the `apijack` CLI framework.

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
# Option 1: via uvicorn directly
uvicorn main:app --port 3457

# Option 2: run the script
python main.py
```

The server starts on `http://localhost:3457`.

## Credentials

Basic auth with hardcoded credentials:

- **Username:** `admin`
- **Password:** `password`

## OpenAPI Spec

- FastAPI default: `http://localhost:3457/openapi.json`
- Compatibility alias: `http://localhost:3457/v3/api-docs`
- Swagger UI: `http://localhost:3457/docs`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /books | List books (query: `?author=`, `?genre=`) |
| GET | /books/{id} | Get a book |
| POST | /books | Create a book |
| PUT | /books/{id} | Update a book |
| DELETE | /books/{id} | Delete a book |
| GET | /authors | List authors |
| POST | /authors | Create an author |
| GET | /authors/{id} | Get author with their books |
| POST | /books/{id}/reviews | Add a review |
| GET | /books/{id}/reviews | List reviews for a book |

## Seed Data

The server starts with 3 authors, 4 books, and 3 reviews pre-loaded.
