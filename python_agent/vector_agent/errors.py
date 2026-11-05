class APIError(Exception):
    def __init__(self, message, usage=None, *, retryable=False, retry_after=None, code=None):
        super().__init__(message)
        self.usage = usage or {}
        self.retryable = retryable
        self.retry_after = retry_after
        self.code = code
