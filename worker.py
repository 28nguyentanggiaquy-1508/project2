from redis import Redis
from rq import Worker, Queue

redis_conn = Redis()
queue = Queue(connection=redis_conn)

Worker([queue], connection=redis_conn).work()