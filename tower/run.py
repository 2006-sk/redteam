#!/usr/bin/env python3
"""Boot The Tower inside a Wasmer sandbox."""

from src.host import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())
