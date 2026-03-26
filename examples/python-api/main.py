"""
Bookstore API — A simple example REST API for testing the apijack CLI framework.

FastAPI app with in-memory storage, basic auth, and OpenAPI spec generation.
Run: uvicorn main:app --port 3457
Credentials: admin / password
"""

import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class BookCreate(BaseModel):
    title: str
    author: str
    genre: str = "fiction"
    isbn: Optional[str] = None
    price: float = 0.0


class BookUpdate(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    genre: Optional[str] = None
    isbn: Optional[str] = None
    price: Optional[float] = None


class Book(BaseModel):
    id: int
    title: str
    author: str
    genre: str = "fiction"
    isbn: Optional[str] = None
    price: float = 0.0
    created_at: str


class AuthorCreate(BaseModel):
    name: str
    bio: str = ""


class Author(BaseModel):
    id: int
    name: str
    bio: str = ""


class AuthorDetail(BaseModel):
    id: int
    name: str
    bio: str = ""
    books: list[Book] = []


class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5, description="Rating from 1 to 5")
    comment: str = ""


class Review(BaseModel):
    id: int
    book_id: int
    rating: int = Field(..., ge=1, le=5)
    comment: str = ""


# ---------------------------------------------------------------------------
# In-memory storage + seed data
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


books_db: dict[int, Book] = {}
authors_db: dict[int, Author] = {}
reviews_db: dict[int, Review] = {}

_next_book_id = 1
_next_author_id = 1
_next_review_id = 1


def _seed() -> None:
    global _next_book_id, _next_author_id, _next_review_id

    # Authors
    seed_authors = [
        AuthorCreate(name="Frank Herbert", bio="American science-fiction author"),
        AuthorCreate(name="Ursula K. Le Guin", bio="American author of novels and short stories"),
        AuthorCreate(name="Isaac Asimov", bio="American writer and professor of biochemistry"),
    ]
    for a in seed_authors:
        authors_db[_next_author_id] = Author(id=_next_author_id, **a.model_dump())
        _next_author_id += 1

    # Books
    seed_books = [
        BookCreate(title="Dune", author="Frank Herbert", genre="science fiction", isbn="978-0441013593", price=9.99),
        BookCreate(title="The Left Hand of Darkness", author="Ursula K. Le Guin", genre="science fiction", isbn="978-0441478125", price=8.99),
        BookCreate(title="Foundation", author="Isaac Asimov", genre="science fiction", isbn="978-0553293357", price=7.99),
        BookCreate(title="Dune Messiah", author="Frank Herbert", genre="science fiction", isbn="978-0593098233", price=9.49),
    ]
    for b in seed_books:
        books_db[_next_book_id] = Book(id=_next_book_id, created_at=_now(), **b.model_dump())
        _next_book_id += 1

    # Reviews
    seed_reviews = [
        ReviewCreate(rating=5, comment="A masterpiece of world-building"),
        ReviewCreate(rating=4, comment="Thought-provoking exploration of gender"),
        ReviewCreate(rating=5, comment="The foundation of modern sci-fi"),
    ]
    for i, r in enumerate(seed_reviews, start=1):
        reviews_db[_next_review_id] = Review(id=_next_review_id, book_id=i, **r.model_dump())
        _next_review_id += 1


_seed()

# ---------------------------------------------------------------------------
# App + auth
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Bookstore API",
    description="A simple bookstore REST API for testing the apijack CLI framework.",
    version="1.0.0",
)

security = HTTPBasic()

VALID_USERNAME = "admin"
VALID_PASSWORD = "password"


def verify_credentials(
    credentials: HTTPBasicCredentials = Depends(security),
) -> str:
    correct_username = secrets.compare_digest(credentials.username, VALID_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, VALID_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ---------------------------------------------------------------------------
# OpenAPI compatibility endpoint
# ---------------------------------------------------------------------------


@app.get("/v3/api-docs", include_in_schema=False)
def openapi_compat() -> JSONResponse:
    """Return the OpenAPI spec at the /v3/api-docs path for compatibility."""
    return JSONResponse(content=app.openapi())


# ---------------------------------------------------------------------------
# Book endpoints
# ---------------------------------------------------------------------------


@app.get("/books", response_model=list[Book], tags=["Books"])
def list_books(
    author: Optional[str] = Query(None, description="Filter by author name (case-insensitive substring)"),
    genre: Optional[str] = Query(None, description="Filter by genre (case-insensitive substring)"),
    _user: str = Depends(verify_credentials),
) -> list[Book]:
    """List all books, optionally filtered by author and/or genre."""
    result = list(books_db.values())
    if author:
        result = [b for b in result if author.lower() in b.author.lower()]
    if genre:
        result = [b for b in result if genre.lower() in b.genre.lower()]
    return result


@app.get("/books/{book_id}", response_model=Book, tags=["Books"])
def get_book(
    book_id: int,
    _user: str = Depends(verify_credentials),
) -> Book:
    """Get a single book by ID."""
    if book_id not in books_db:
        raise HTTPException(status_code=404, detail="Book not found")
    return books_db[book_id]


@app.post("/books", response_model=Book, status_code=201, tags=["Books"])
def create_book(
    book: BookCreate,
    _user: str = Depends(verify_credentials),
) -> Book:
    """Create a new book."""
    global _next_book_id
    new_book = Book(id=_next_book_id, created_at=_now(), **book.model_dump())
    books_db[_next_book_id] = new_book
    _next_book_id += 1
    return new_book


@app.put("/books/{book_id}", response_model=Book, tags=["Books"])
def update_book(
    book_id: int,
    updates: BookUpdate,
    _user: str = Depends(verify_credentials),
) -> Book:
    """Update an existing book."""
    if book_id not in books_db:
        raise HTTPException(status_code=404, detail="Book not found")
    existing = books_db[book_id]
    update_data = updates.model_dump(exclude_unset=True)
    updated = existing.model_copy(update=update_data)
    books_db[book_id] = updated
    return updated


@app.delete("/books/{book_id}", status_code=204, tags=["Books"])
def delete_book(
    book_id: int,
    _user: str = Depends(verify_credentials),
) -> None:
    """Delete a book by ID."""
    if book_id not in books_db:
        raise HTTPException(status_code=404, detail="Book not found")
    del books_db[book_id]
    # Also remove associated reviews
    to_remove = [rid for rid, r in reviews_db.items() if r.book_id == book_id]
    for rid in to_remove:
        del reviews_db[rid]


# ---------------------------------------------------------------------------
# Author endpoints
# ---------------------------------------------------------------------------


@app.get("/authors", response_model=list[Author], tags=["Authors"])
def list_authors(
    _user: str = Depends(verify_credentials),
) -> list[Author]:
    """List all authors."""
    return list(authors_db.values())


@app.post("/authors", response_model=Author, status_code=201, tags=["Authors"])
def create_author(
    author: AuthorCreate,
    _user: str = Depends(verify_credentials),
) -> Author:
    """Create a new author."""
    global _next_author_id
    new_author = Author(id=_next_author_id, **author.model_dump())
    authors_db[_next_author_id] = new_author
    _next_author_id += 1
    return new_author


@app.get("/authors/{author_id}", response_model=AuthorDetail, tags=["Authors"])
def get_author(
    author_id: int,
    _user: str = Depends(verify_credentials),
) -> AuthorDetail:
    """Get an author by ID, including their books."""
    if author_id not in authors_db:
        raise HTTPException(status_code=404, detail="Author not found")
    author = authors_db[author_id]
    author_books = [b for b in books_db.values() if b.author.lower() == author.name.lower()]
    return AuthorDetail(**author.model_dump(), books=author_books)


# ---------------------------------------------------------------------------
# Review endpoints
# ---------------------------------------------------------------------------


@app.post("/books/{book_id}/reviews", response_model=Review, status_code=201, tags=["Reviews"])
def create_review(
    book_id: int,
    review: ReviewCreate,
    _user: str = Depends(verify_credentials),
) -> Review:
    """Add a review for a book."""
    if book_id not in books_db:
        raise HTTPException(status_code=404, detail="Book not found")
    global _next_review_id
    new_review = Review(id=_next_review_id, book_id=book_id, **review.model_dump())
    reviews_db[_next_review_id] = new_review
    _next_review_id += 1
    return new_review


@app.get("/books/{book_id}/reviews", response_model=list[Review], tags=["Reviews"])
def list_reviews(
    book_id: int,
    _user: str = Depends(verify_credentials),
) -> list[Review]:
    """List all reviews for a book."""
    if book_id not in books_db:
        raise HTTPException(status_code=404, detail="Book not found")
    return [r for r in reviews_db.values() if r.book_id == book_id]


# ---------------------------------------------------------------------------
# Run with uvicorn when executed directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3457)
