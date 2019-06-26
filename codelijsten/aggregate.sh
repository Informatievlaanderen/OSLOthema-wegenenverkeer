#!/bin/bash

rm -f all.ttl

for i in `ls -1 *.ttl`  ; do
echo $i
if [ -e $i ] ; then 
	cat $i >> all.ttl
fi
done
